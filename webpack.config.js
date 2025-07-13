// webpack.config.js

const fs = require("fs");
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

const LOGS_ENABLED = process.env.STAGE === "dev" || false;
const IS_DEVELOPMENT = process.env.STAGE === "dev";
const INIT_SCRIPT_PATH = "./static/js/theme/init.js";
const ERROR_PAGES_FOLDER = "./static/errors";
const CSS_STYLES_FOLDER = "./static/css";
const JS_SCRIPTS_FOLDER = "./static/js";
const IMG_ASSET_FOLDER = "./static/img";
const FAVICON_PATH = "static/favicon.ico";

// Helper function to minify inline JS
async function minifyInlineJs(code) {
    if (IS_DEVELOPMENT) {
        return code; // Don't minify in development
    }
    const result = await minify(code, {
        compress: {
            drop_console: !LOGS_ENABLED,
        },
    });
    return result.code;
}

// Create minified init code synchronously
const initScript = fs.readFileSync(INIT_SCRIPT_PATH, "utf-8");
let minifiedInitScript = "";
(async () => {
    minifiedInitScript = await minifyInlineJs(initScript);
})();

// Template helpers
const templateHelpers = {
    getInitScript: () =>
        `<script type="text/javascript">${minifiedInitScript}</script>`,
};

// Get all error pages
const errorPages = fs
    .readdirSync(`${ERROR_PAGES_FOLDER}`)
    .filter((filename) => filename.endsWith(".html"))
    .map((filename) => ({
        name: filename.replace(".html", ""),
        path: `${ERROR_PAGES_FOLDER}/${filename}`,
    }));

const errorHtmlPlugins = errorPages.map(
    (page) =>
        new HtmlWebpackPlugin({
            template: page.path,
            filename: `errors/${page.name}.html`,
            chunks: [],
            minify: IS_DEVELOPMENT
                ? false
                : {
                      removeAttributeQuotes: true,
                      collapseWhitespace: true,
                      removeComments: true,
                      minifyJS: true,
                      minifyCSS: true,
                  },
            inject: true,
        })
);

module.exports = {
    mode: IS_DEVELOPMENT ? "development" : "production",
    entry: {
        main: [`${JS_SCRIPTS_FOLDER}/main.js`],
        styles: `${CSS_STYLES_FOLDER}/styles.css`,
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: IS_DEVELOPMENT
            ? "js/[name].js"
            : "js/[name].[contenthash].js",
        assetModuleFilename: "assets/[hash][ext][query]",
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules|static\/js\/generated-sdk/,
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: ["@babel/preset-env"],
                    },
                },
            },
            {
                test: /\.css$/,
                use: [
                    MiniCssExtractPlugin.loader,
                    "css-loader",
                    "postcss-loader",
                ],
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif)$/i,
                type: "asset",
                parser: {
                    dataUrlCondition: {
                        maxSize: 8 * 1024,
                    },
                },
            },
            {
                test: /\.ico$/,
                type: "asset/resource",
                generator: {
                    filename: "[name][ext]",
                },
            },
        ],
    },
    optimization: {
        minimize: !IS_DEVELOPMENT, // Disable minimization in development
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: !LOGS_ENABLED,
                    },
                },
                exclude: /js\/generated-sdk/,
            }),
            new CssMinimizerPlugin(),
        ],
    },
    plugins: [
        new CleanWebpackPlugin(),
        new HtmlWebpackPlugin({
            template: "./static/index.html",
            filename: "index.html",
            chunks: ["main", "styles"],
            templateParameters: templateHelpers, // Use template helpers here
            minify: IS_DEVELOPMENT
                ? false
                : {
                      removeAttributeQuotes: true,
                      collapseWhitespace: true,
                      removeComments: true,
                      minifyJS: true,
                      minifyCSS: true,
                  },
            inject: true,
        }),
        ...errorHtmlPlugins,
        new MiniCssExtractPlugin({
            filename: IS_DEVELOPMENT
                ? "css/[name].css"
                : "css/[name].[contenthash].css",
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: `${IMG_ASSET_FOLDER}`,
                    to: "img",
                },
                {
                    from: `${FAVICON_PATH}`,
                    to: "favicon.ico",
                },
            ],
        }),
    ],
    devServer: {
        static: "./dist",
        hot: true,
        port: 8080,
        open: true,
    },
    devtool: IS_DEVELOPMENT ? "eval-source-map" : "source-map", // Better debugging in dev
};
