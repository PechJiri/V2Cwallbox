'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const localesDirectory = path.join(__dirname, '..', 'locales');
const supportedLocales = ['ar', 'da', 'de', 'en', 'es', 'fr', 'it', 'ko', 'nl', 'no', 'pl', 'ru', 'sv'];

function loadLocale(locale) {
    return JSON.parse(fs.readFileSync(path.join(localesDirectory, `${locale}.json`), 'utf8'));
}

function assertMatchesReference(reference, translation, locale, currentPath = '') {
    const location = currentPath || '<root>';
    assert.equal(typeof translation, typeof reference, `${locale}: ${location} must match the English value type`);

    if (typeof reference === 'object') {
        assert.ok(reference && !Array.isArray(reference), `English ${location} must be an object`);
        assert.ok(translation && !Array.isArray(translation), `${locale}: ${location} must be an object`);
        const referenceKeys = Object.keys(reference).sort();
        const translationKeys = Object.keys(translation).sort();
        assert.deepEqual(translationKeys, referenceKeys, `${locale}: ${location} keys must match English`);

        for (const key of referenceKeys) {
            const childPath = currentPath ? `${currentPath}.${key}` : key;
            assertMatchesReference(reference[key], translation[key], locale, childPath);
        }
        return;
    }

    assert.equal(typeof reference, 'string', `English ${location} must be a string`);
    assert.equal(translation.trim().length > 0, true, `${locale}: ${location} must not be blank`);
}

test('all supported locales match the English keys and contain translations', () => {
    const localeFiles = fs.readdirSync(localesDirectory)
        .filter((file) => file.endsWith('.json'))
        .sort();
    const expectedFiles = supportedLocales.map((locale) => `${locale}.json`).sort();

    assert.deepEqual(localeFiles, expectedFiles, 'locales directory must contain only the 13 supported locale files');
    assert.equal(localeFiles.includes('cs.json'), false, 'Czech is not a supported locale');

    const reference = loadLocale('en');
    for (const locale of supportedLocales) {
        assertMatchesReference(reference, loadLocale(locale), locale);
    }
});
