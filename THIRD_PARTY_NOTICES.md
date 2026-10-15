# Third-party notices

This fork as a whole is distributed under GNU AGPL version 3 only
(AGPL-3.0-only); see the root LICENSE. The notices and licenses of the
original project and third-party components are retained below.

The Apple Music player includes Apple Music-like Lyrics (AMLL) core, React,
and react-full components, and its TTML parser/converter (1.0.1), distributed
under AGPL-3.0-only.

Upstream: https://github.com/amll-dev/applemusic-like-lyrics
Snapshot: 86200dead453bb067e554e989110cbadca8d4756
Source and local patches: vendor/amll (see its README.md and LICENSE).
The compiled player includes a copy of the AMLL license at
src/vendor/amll-player/LICENSE.txt.
The compiled TTML module also includes src/vendor/amll-ttml/LICENSE.txt.

The original YouLy+ code was distributed under the MIT license; its full
copyright and permission notice is preserved below. This fork's changes and
combined work are distributed under AGPL-3.0-only. Frontend dependencies
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

## Original YouLy+ MIT notice

Upstream: https://github.com/ibratabian17/YouLyPlus

```text
MIT License

Copyright (c) 2025 Ibra Al Tabian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
