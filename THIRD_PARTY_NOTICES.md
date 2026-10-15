# Third-party notices

The Apple Music player includes Apple Music-like Lyrics (AMLL) core, React,
and react-full components, and its TTML parser/converter (1.0.1), distributed
under AGPL-3.0-only.

Upstream: https://github.com/amll-dev/applemusic-like-lyrics
Snapshot: 86200dead453bb067e554e989110cbadca8d4756
Source and local patches: vendor/amll (see its README.md and LICENSE).
The compiled player includes a copy of the AMLL license at
src/vendor/amll-player/LICENSE.txt.
The compiled TTML module also includes src/vendor/amll-ttml/LICENSE.txt.

The original YouLy+ files retain their MIT license. Frontend dependencies
and resolved versions are recorded in package.json and package-lock.json;
their licenses remain in their respective source distributions and license
comments in the production bundle.

The Apple Music player also bundles opencc-js 1.4.2 for local Chinese
Traditional-to-Simplified text conversion. Its JavaScript implementation is
MIT licensed, and the OpenCC dictionary data is Apache-2.0 licensed.
Upstream: https://github.com/nk2028/opencc-js
License copies and data notices are included as OpenCC-LICENSE.txt,
OpenCC-DATA-LICENSE.txt, and OpenCC-NOTICES.md in src/vendor/amll-player/.
No lyrics are sent to an external conversion service.
