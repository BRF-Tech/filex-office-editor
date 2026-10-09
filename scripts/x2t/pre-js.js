// SPDX-License-Identifier: AGPL-3.0-or-later
// From CryptPad's pre-js.js (github.com/cryptpad/onlyoffice-x2t-wasm,
// AGPL-3.0-or-later), used as it is by scripts/x2t/steps.sh: the module does
// not run main on its own (the page calls main1 for each conversion) and
// keeps its runtime between conversions; a page that loads x2t.js with a
// query string loads x2t.wasm with the same one.
Module.noInitialRun = true;
Module.noExitRuntime = true;
(function() {
	let suffix;
	if (typeof document != 'undefined') {
		const myScript = document.currentScript;
		const mySrc = myScript.getAttribute('src');
		suffix = new URL(mySrc).search;
	} else {
		suffix = '';
	}

	Module.locateFile = function(path, prefix) {
		return prefix + path + suffix;
	};
})();
