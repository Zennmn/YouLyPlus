function storageLocalGet(keys) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local.get(keys);
    }
    return new Promise((resolve, reject) => chrome.storage.local.get(keys, result => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result);
    }));
}

function storageLocalSet(items) {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local.set(items);
    }
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}
