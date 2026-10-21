// ==================================================================================================
// DATABASE LAYER
// ==================================================================================================

import { CONFIG } from '../constants.js';

class DatabaseManager {
  constructor(dbConfig) {
    this.config = dbConfig;
  }

  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.name, this.config.version);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.config.store)) {
          db.createObjectStore(this.config.store, { keyPath: this.config.store === 'localLyrics' ? 'songId' : 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error(`Failed to open ${this.config.name}`));
      request.onblocked = () => reject(new Error(`Database upgrade blocked: ${this.config.name}`));
    });
  }

  /**
   * Resolve only after the transaction commits. Request errors are retained until the
   * transaction aborts so callers never treat a rolled-back write as successful.
   */
  async transact(mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let transaction;
      let settled = false;
      let result;
      let failure = null;

      const finishRejected = (error) => {
        if (settled) return;
        settled = true;
        db.close();
        reject(error instanceof Error ? error : new Error(String(error || 'IndexedDB transaction failed')));
      };

      const abortWith = (error) => {
        if (!failure) failure = error;
        try {
          transaction?.abort();
        } catch (_) {
          finishRejected(failure);
        }
      };

      try {
        transaction = db.transaction([this.config.store], mode);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }

      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(result);
      };
      transaction.onerror = () => {
        failure ||= transaction.error || new Error(`IndexedDB transaction failed: ${this.config.store}`);
      };
      transaction.onabort = () => {
        finishRejected(failure || transaction.error || new Error(`IndexedDB transaction aborted: ${this.config.store}`));
      };

      try {
        operation(
          transaction.objectStore(this.config.store),
          value => { result = value; },
          abortWith
        );
      } catch (error) {
        abortWith(error);
      }
    });
  }

  async get(key) {
    return this.transact('readonly', (store, setResult, abortWith) => {
      const request = store.get(key);
      request.onsuccess = () => setResult(request.result);
      request.onerror = () => abortWith(request.error);
    });
  }

  async set(data) {
    await this.transact('readwrite', (store, _setResult, abortWith) => {
      const request = store.put(data);
      request.onerror = () => abortWith(request.error);
    });
  }

  async delete(key) {
    await this.transact('readwrite', (store, _setResult, abortWith) => {
      const request = store.delete(key);
      request.onerror = () => abortWith(request.error);
    });
  }

  /**
   * Atomically moves a local record to a new key unless a newer exact record already exists.
   * Reads and writes share one readwrite transaction, so a concurrent upload cannot be
   * replaced by a migration that started from older metadata.
   */
  async putLocalIfNotOlder(record, previousKey) {
    return this.transact('readwrite', (store, setResult, abortWith) => {
      const sourceLookup = store.get(previousKey);
      sourceLookup.onerror = () => abortWith(sourceLookup.error);
      sourceLookup.onsuccess = () => {
        const source = sourceLookup.result;
        if (!source) {
          setResult(null);
          return;
        }

        const lookup = store.get(record.songId);
        lookup.onerror = () => abortWith(lookup.error);
        lookup.onsuccess = () => {
          const current = lookup.result;
          const incomingTime = Number(record.timestamp) || 0;
          const currentTime = Number(current?.timestamp) || 0;
          if (current && currentTime >= incomingTime) {
            setResult(current);
            return;
          }
          try {
            const putRequest = store.put(record);
            putRequest.onerror = () => abortWith(putRequest.error);
            if (previousKey !== record.songId) {
              const deleteRequest = store.delete(previousKey);
              deleteRequest.onerror = () => abortWith(deleteRequest.error);
            }
            setResult(record);
          } catch (error) {
            abortWith(error);
          }
        };
      };
    });
  }

  async deleteExpired(expirationTimeMs) {
    return this.transact('readwrite', (store, setResult, abortWith) => {
      const request = store.openCursor();
      const now = Date.now();
      let deletedCount = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          setResult(deletedCount);
          return;
        }
        try {
          if (cursor.value.timestamp && now - cursor.value.timestamp > expirationTimeMs) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } catch (error) {
          abortWith(error);
        }
      };
      request.onerror = () => abortWith(request.error);
    });
  }

  async getAll() {
    return this.transact('readonly', (store, setResult, abortWith) => {
      const request = store.getAll();
      request.onsuccess = () => setResult(request.result);
      request.onerror = () => abortWith(request.error);
    });
  }

  async clear() {
    await this.transact('readwrite', (store, _setResult, abortWith) => {
      const request = store.clear();
      request.onerror = () => abortWith(request.error);
    });
  }

  async deleteWhere(predicate) {
    return this.transact('readwrite', (store, setResult, abortWith) => {
      const request = store.openCursor();
      let deletedCount = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          setResult(deletedCount);
          return;
        }
        try {
          if (predicate(cursor.value, cursor.key)) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } catch (error) {
          abortWith(error);
        }
      };
      request.onerror = () => abortWith(request.error);
    });
  }

  async getBreakdown() {
    const records = await this.getAll();
    let transBytes = 0;
    let transCount = 0;
    let romBytes = 0;
    let romCount = 0;

    for (const record of records) {
      const bytes = new TextEncoder().encode(JSON.stringify(record)).length;
      if (record.key && record.key.includes(' - romanize - ')) {
        romBytes += bytes;
        romCount++;
      } else {
        transBytes += bytes;
        transCount++;
      }
    }

    return {
      translations: { sizeKB: transBytes / 1024, count: transCount },
      romanizations: { sizeKB: romBytes / 1024, count: romCount }
    };
  }

  async estimateSize() {
    return this.transact('readonly', (store, setResult, abortWith) => {
      const getAllRequest = store.getAll();
      const countRequest = store.count();
      let sizeKB = 0;
      let count = 0;
      let completed = 0;

      const finishPart = () => {
        completed++;
        if (completed === 2) setResult({ sizeKB, count });
      };

      getAllRequest.onsuccess = () => {
        const totalBytes = getAllRequest.result.reduce(
          (total, record) => total + new TextEncoder().encode(JSON.stringify(record)).length,
          0
        );
        sizeKB = totalBytes / 1024;
        finishPart();
      };
      getAllRequest.onerror = () => abortWith(getAllRequest.error);

      countRequest.onsuccess = () => {
        count = countRequest.result;
        finishPart();
      };
      countRequest.onerror = () => abortWith(countRequest.error);
    });
  }
}

// Database instances
export const lyricsDB = new DatabaseManager(CONFIG.DB.CACHE);
export const translationsDB = new DatabaseManager(CONFIG.DB.TRANSLATIONS);
export const localLyricsDB = new DatabaseManager(CONFIG.DB.LOCAL);
export const offsetsDB = new DatabaseManager(CONFIG.DB.OFFSETS);
export const dictionaryDB = new DatabaseManager(CONFIG.DB.DICTIONARY);
