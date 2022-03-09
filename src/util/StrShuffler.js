/*

baseDictionary originally generated with (certain characters was removed to avoid breaking pages):

let str = '';
for (let i = 32; i <= 126; i++) {
  let c = String.fromCharCode(i);
  if (c !== '/' && c !== '_' && encodeURI(c).length === 1) str += c;
}

*/

const mod = (n, m) => ((n % m) + m) % m;
class StrShuffler {
    static baseDictionary = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~-';
    static shuffledIndicator = '_rhs';
    static generateDictionary() {
        let str = '';
        const split = StrShuffler.baseDictionary.split('');
        while (split.length > 0) {
            str += split.splice(Math.floor(Math.random() * split.length), 1)[0];
        }
        return str;
    }

    constructor(dictionary = StrShuffler.generateDictionary()) {
        this.dictionary = dictionary;
    }
    shuffle(str) {
        if (str.startsWith(StrShuffler.shuffledIndicator)) {
            return str;
        }
        let shuffledStr = '';
        for (let i = 0; i < str.length; i++) {
            const char = str.charAt(i);
            const idx = StrShuffler.baseDictionary.indexOf(char);
            if (idx === -1) {
                shuffledStr += char;
            } else {
                shuffledStr += this.dictionary.charAt(mod(idx + i, StrShuffler.baseDictionary.length));
            }
        }
        return StrShuffler.shuffledIndicator + shuffledStr;
    }
    unshuffle(str) {
        if (!str.startsWith(StrShuffler.shuffledIndicator)) {
            return str;
        }

        str = str.slice(StrShuffler.shuffledIndicator.length);

        let unshuffledStr = '';
        for (let i = 0; i < str.length; i++) {
            const char = str.charAt(i);
            const idx = this.dictionary.indexOf(char);
            if (idx === -1) {
                unshuffledStr += char;
            } else {
                unshuffledStr += StrShuffler.baseDictionary.charAt(mod(idx - i, StrShuffler.baseDictionary.length));
            }
        }
        return unshuffledStr;
    }
}

module.exports = StrShuffler;
