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

// import * as config from "../config/config.js";

// export const isBase64 = (imageData) => {
//     return (
//         imageData.startsWith("iVBORw0") || imageData.startsWith("data:image")
//     );
// };

// export const getBase64Image = (imageDataAsBase64) => {
//     return `data:image/png;base64,${imageDataAsBase64.replace(
//         /^data:image\/\w+;base64,/,
//         ""
//     )}`;
// };

// export const getImageUrl = (imageDataAsUrl) => {
//     try {
//         if (imageDataAsUrl.startsWith("/output/")) {
//             return imageDataAsUrl;
//         }
//         if (imageDataAsUrl.startsWith("output/")) {
//             return `/${imageDataAsUrl}`;
//         }
//         const urlObj = new URL(imageDataAsUrl);
//         const path = urlObj.pathname;
//         const outputIndex = path.indexOf("/output/");
//         if (outputIndex !== -1) {
//             return path.slice(outputIndex);
//         }
//         throw new Error("URL does not contain expected /output/ path");
//     } catch (error) {
//         console.error(error);
//         throw new Error(`Invalid URL or unexpected format: ${error.message}`);
//     }
// };

// export const is404Error = (error) => {
//     return error.httpStatus === 404 || error.httpStatus === "404";
// };

// export const isFirewallThrottlingError = (error) => {
//     // console.error(error);

//     if (error.httpStatus === 403 && error.errorType === "ForbiddenException") {
//         return true;
//     }

//     // Check for Failed to fetch errors (which could be from preflight failure)
//     if (error instanceof TypeError && error.message === "Failed to fetch") {
//         return true;
//     }

//     // Check for explicit CORS preflight errors
//     if (error.message?.includes("CORS error")) {
//         return true;
//     }

//     return false;
// };

// export const calculateGCD = (a, b) => {
//     while (b !== 0) {
//         const temp = b;
//         b = a % b;
//         a = temp;
//     }
//     return a;
// };

// export const extractProgress = (data) => {
//     if (
//         data.output &&
//         typeof data.output === "string" &&
//         data.output.includes("%") &&
//         data.output != "0%"
//     ) {
//         const progress = parseInt(data.output);
//         return {
//             value: progress,
//             details: `Progress: ${progress}%`,
//             status: "In Progress",
//         };
//     }
//     return config.LOADING_PROGRESS_STATE;
// };
