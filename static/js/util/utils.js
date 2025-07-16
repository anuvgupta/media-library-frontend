/* utilities */

export const utf8ToBase64 = (str) => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const binString = Array.from(bytes, (byte) =>
        String.fromCodePoint(byte)
    ).join("");
    return btoa(binString);
};

export const base64ToUtf8 = (base64) => {
    const binString = atob(base64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
        bytes[i] = binString.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
};
