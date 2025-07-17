// config.js

/* smart constants */
export const isProd = () => {
    const HOST_NAME = `${window.location.hostname}`;
    return (
        !HOST_NAME.includes("-dev") &&
        !HOST_NAME.includes("dev.") &&
        window.location.hostname != "localhost"
    );
};
export const onAlternateDomain = () => {
    return window.location.hostname.endsWith("streamy.sh");
};
export const getApiBaseUrl = () => {
    const BASE_API_DOMAIN_ORIG_DEV = "media-api-dev.anuv.me";
    const BASE_API_DOMAIN_ORIG_PROD = "media-api.anuv.me";
    const BASE_API_DOMAIN_ALT_DEV = "api-dev.streamy.sh";
    const BASE_API_DOMAIN_ALT_PROD = "api.streamy.sh";
    const BASE_API_DOMAIN_PROD = onAlternateDomain()
        ? BASE_API_DOMAIN_ALT_PROD
        : BASE_API_DOMAIN_ORIG_PROD;
    const BASE_API_DOMAIN_DEV = onAlternateDomain()
        ? BASE_API_DOMAIN_ALT_DEV
        : BASE_API_DOMAIN_ORIG_DEV;
    const BASE_API_DOMAIN = isProd()
        ? BASE_API_DOMAIN_PROD
        : BASE_API_DOMAIN_DEV;
    return `https://${BASE_API_DOMAIN}`;
};
export const getCognitoIdentityPoolId = () => {
    const COGNITO_IDENTITY_POOL_ID_DEV =
        "us-east-1:570a2eb4-5ca1-45e9-af46-bd0fa187f7fc";
    const COGNITO_IDENTITY_POOL_ID_PROD =
        "us-east-1:47930d9c-40f9-4ee3-ba0e-2c497a513c06";
    const COGNITO_IDENTITY_POOL_ID = isProd()
        ? COGNITO_IDENTITY_POOL_ID_PROD
        : COGNITO_IDENTITY_POOL_ID_DEV;
    return COGNITO_IDENTITY_POOL_ID;
};
export const getCognitoUserPoolId = () => {
    const COGNITO_USER_POOL_ID_DEV = "us-east-1_7PxCwRosi";
    const COGNITO_USER_POOL_ID_PROD = "us-east-1_4YNieRZi1";
    const COGNITO_USER_POOL_ID = isProd()
        ? COGNITO_USER_POOL_ID_PROD
        : COGNITO_USER_POOL_ID_DEV;
    return COGNITO_USER_POOL_ID;
};
export const getCognitoUserPoolClientId = () => {
    const COGNITO_USER_POOL_CLIENT_ID_DEV = "jd5ta6pde3j5sl2fhl11qgodh";
    const COGNITO_USER_POOL_CLIENT_ID_PROD = "u0ngupocjumsl753106mcunpg";
    const COGNITO_USER_POOL_CLIENT_ID = isProd()
        ? COGNITO_USER_POOL_CLIENT_ID_PROD
        : COGNITO_USER_POOL_CLIENT_ID_DEV;
    return COGNITO_USER_POOL_CLIENT_ID;
};
export const getAwsMediaBucket = () => {
    const AWS_MEDIA_BUCKET_DEV = "media-library-media-738123590383-dev";
    const AWS_MEDIA_BUCKET_PROD = "media-library-media-738123590383-prod";
    const AWS_MEDIA_BUCKET = isProd()
        ? AWS_MEDIA_BUCKET_PROD
        : AWS_MEDIA_BUCKET_DEV;
    return AWS_MEDIA_BUCKET;
};
export const getAwsPlaylistBucket = () => {
    const AWS_MEDIA_BUCKET_DEV = "media-library-playlist-738123590383-dev";
    const AWS_MEDIA_BUCKET_PROD = "media-library-playlist-738123590383-prod";
    const AWS_MEDIA_BUCKET = isProd()
        ? AWS_MEDIA_BUCKET_PROD
        : AWS_MEDIA_BUCKET_DEV;
    return AWS_MEDIA_BUCKET;
};
export const getAwsRegion = () => {
    const AWS_REGION = "us-east-1";
    return AWS_REGION;
};

/* exports */
export const CONFIG = {
    // Stage
    isProd: isProd(),

    // AWS Region
    region: getAwsRegion(),

    // Cognito User Pool ID (from CDK output: UserPoolId)
    userPoolId: getCognitoUserPoolId(),

    // Cognito User Pool Web Client ID (from CDK output: UserPoolClientId)
    userPoolWebClientId: getCognitoUserPoolClientId(),

    // Cognito Identity Pool ID (from CDK output: IdentityPoolId)
    identityPoolId: getCognitoIdentityPoolId(),

    // S3 buckets
    awsMediaBucket: getAwsMediaBucket(),
    awsPlaylistBucket: getAwsPlaylistBucket(),

    // API Gateway endpoint URL (from CDK output: ApiUrl or custom domain)
    // Optional: Custom API domain (if you set up custom domain for API)
    apiEndpoint: getApiBaseUrl(),

    tmdbPosterUrlPrefix1280: "https://image.tmdb.org/t/p/w1280",
    tmdbPosterUrlPrefix500: "https://image.tmdb.org/t/p/w500",
};
