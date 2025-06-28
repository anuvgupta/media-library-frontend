// config.js

// Configuration file for Media Library Frontend
// Update these values with your actual CDK stack outputs

export const CONFIG = {
    // AWS Region where your resources are deployed
    region: "us-east-1",

    // Cognito User Pool ID (from CDK output: UserPoolId)
    userPoolId: "us-east-1_7PxCwRosi",

    // Cognito User Pool Web Client ID (from CDK output: UserPoolClientId)
    userPoolWebClientId: "jd5ta6pde3j5sl2fhl11qgodh",

    // Cognito Identity Pool ID (from CDK output: IdentityPoolId)
    identityPoolId: "us-east-1:570a2eb4-5ca1-45e9-af46-bd0fa187f7fc",

    // API Gateway endpoint URL (from CDK output: ApiUrl or custom domain)
    // Optional: Custom API domain (if you set up custom domain for API)
    apiEndpoint: "https://media-api-dev.anuv.me",

    tmdbPosterUrlPrefix1280: "https://image.tmdb.org/t/p/w1280",
    tmdbPosterUrlPrefix500: "https://image.tmdb.org/t/p/w500",
};

// Example of how to get these values from your CDK deployment:
/*
After deploying your CDK stack, you'll see outputs like:

MediaLibraryStack.UserPoolId = us-west-2_AbC123DeF
MediaLibraryStack.UserPoolClientId = 1a2b3c4d5e6f7g8h9i0j1k2l3m
MediaLibraryStack.IdentityPoolId = us-west-2:12345678-1234-1234-1234-123456789012
MediaLibraryStack.ApiUrl = https://abc123def4.execute-api.us-west-2.amazonaws.com/prod/

Copy these values into the CONFIG object above.
*/

// /* constants */
// export const CHECK_BUCKET_FIRST = true;
// export const DEFAULT_ASPECT_RATIO = "9_16";
// export const DEFAULT_WORKFLOW = "sdxl_lightning_6step_juggernaut_xi";
// export const WORKFLOWS = [
//     {
//         param: "sd_1_5",
//         name: "Stable Diffusion 1.5",
//     },
//     {
//         param: "sdxl_lightning_4step",
//         name: "SDXL Lightning 4-step",
//     },
//     {
//         param: "sdxl_lightning_8step",
//         name: "SDXL Lightning 8-step",
//     },
//     {
//         param: "sdxl_lightning_6step_juggernaut_xi",
//         name: "SDXL Lightning 6-step Juggernaut",
//     },
// ];
// const SCRIBBLE_WORKFLOW = "sdxl_lightning_6step_juggernaut_xi_scribble";
// export const ASPECT_RATIOS = [
//     {
//         param: "1_1",
//         name: "1:1 Square",
//     },
//     {
//         param: "9_16",
//         name: "9:16 Portrait",
//     },
//     {
//         param: "16_9",
//         name: "16:9 Landscape",
//     },
//     {
//         param: "3_2",
//         name: "3:2 Classic",
//     },
//     {
//         param: "4_3",
//         name: "4:3 Standard",
//     },
// ];
// export const PLACEHOLDER_TEXT = "Generated image will appear here";
// export const DEFAULT_ERROR_MESSAGE =
//     "Something went wrong. Please try again later.";
// export const FIREWALL_THROTTLING_ERROR_MESSAGE =
//     "Too many images! Please wait 5 minutes and try again...";

// export const COMPLETED_PROGRESS_STATE = {
//     value: 100,
//     status: "Generated",
//     details: "Your image is done!",
// };
// export const EXPIRING_PROGRESS_STATE = {
//     value: 100,
//     status: "Generated",
//     details: "⚠️ This image is expiring soon!",
// };
// export const QUEUED_PROGRESS_STATE = {
//     value: 0,
//     status: "In Queue",
//     details: "Waiting for worker...",
// };
// export const LOADING_PROGRESS_STATE = {
//     value: 0,
//     status: "In Progress",
//     details: "Loading model...",
// };

// /* smart constants */
// export const isProd = () => {
//     const HOST_NAME = `${window.location.hostname}`;
//     return (
//         !HOST_NAME.includes("-dev") && window.location.hostname != "localhost"
//     );
// };
// export const getBaseUrl = () => {
//     const BASE_DOMAIN_DEV = "images-api-dev.anuv.me";
//     const BASE_DOMAIN_PROD = "images-api.anuv.me";
//     const BASE_DOMAIN = isProd() ? BASE_DOMAIN_PROD : BASE_DOMAIN_DEV;
//     return `https://${BASE_DOMAIN}`;
// };
// export const getCognitoIdentityPoolId = () => {
//     const COGNITO_IDENTITY_POOL_ID_DEV =
//         "us-east-1:3076c426-e44d-4a4f-bc62-6621dc0500c6";
//     const COGNITO_IDENTITY_POOL_ID_PROD =
//         "us-east-1:475ceb5c-9c31-4d8c-a480-f478d62fec25";
//     const COGNITO_IDENTITY_POOL_ID = isProd()
//         ? COGNITO_IDENTITY_POOL_ID_PROD
//         : COGNITO_IDENTITY_POOL_ID_DEV;
//     return COGNITO_IDENTITY_POOL_ID;
// };
// export const getAwsRegion = () => {
//     const AWS_REGION = "us-east-1";
//     return AWS_REGION;
// };
