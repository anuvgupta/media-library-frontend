// // main.js

// import {
//     initializeApiClient,
//     generateImage,
//     getJobStatus,
// } from "./api/api-client.js";
// import * as utils from "./util/utils.js";
// import * as config from "./config/config.js";
// import * as themeSystem from "./theme/system.js";

// /* memory */
// let currentJobId = null;
// let pollingInterval = null;

// /* ui elements */
// const elements = {
//     promptInput: document.getElementById("promptInput"),
//     workflowSelect: document.getElementById("workflowSelect"),
//     generateBtn: document.getElementById("generateBtn"),
//     errorMessage: document.getElementById("errorMessage"),
//     progressContainer: document.getElementById("progressContainer"),
//     progressFill: document.getElementById("progressFill"),
//     progressStatus: document.getElementById("progressStatus"),
//     statusDetails: document.getElementById("statusDetails"),
//     imagePlaceholder: document.getElementById("imagePlaceholder"),
//     generatedImage: document.getElementById("generatedImage"),
//     loadingSpinner: document.getElementById("loadingSpinner"),
//     placeholderText: document.getElementById("placeholderText"),
//     aspectRatioSelect: document.getElementById("aspectRatioSelect"),
// };

// /* ui methods */
// const setLoading = (loading) => {
//     elements.generateBtn.disabled = loading;
//     showProgressSection();
// };

// const showPlaceholder = () => {
//     elements.placeholderText.style.display = "block";
//     elements.placeholderText.innerHTML = config.PLACEHOLDER_TEXT;
// };

// const hidePlaceholder = () => {
//     elements.placeholderText.style.display = "none";
// };

// const showProgressSection = () => {
//     elements.progressContainer.style.display = "block";
// };

// const hideProgressSection = () => {
//     elements.progressContainer.style.display = "none";
// };

// const resetProgressSection = () => {
//     elements.progressFill.style.width = "0%";
//     elements.progressStatus.textContent = "Loading...";
//     elements.statusDetails.innerHTML = "&nbsp;";
// };

// const showError = (message = config.DEFAULT_ERROR_MESSAGE) => {
//     elements.errorMessage.textContent = message;
//     elements.errorMessage.style.display = "block";
//     elements.loadingSpinner.style.display = "none";
//     hideProgressSection();
// };

// const hideError = () => {
//     elements.errorMessage.style.display = "none";
// };

// const displayImage = (imageData) => {
//     elements.generatedImage.src = utils.isBase64(imageData)
//         ? utils.getBase64Image(imageData)
//         : utils.getImageUrl(imageData);
//     elements.generatedImage.style.display = "block";
//     elements.imagePlaceholder.style.display = "none";
//     elements.loadingSpinner.style.display = "none";
//     showPlaceholder();
// };

// const updateProgress = (progressData) => {
//     elements.progressFill.style.width = `${progressData.value}%`;
//     elements.progressStatus.textContent = progressData.status;
//     elements.statusDetails.textContent = progressData.details;
// };

// /* app methods */
// const initializeApi = async () => {
//     initializeApiClient(
//         config.getCognitoIdentityPoolId(),
//         config.getAwsRegion(),
//         config.getBaseUrl()
//     ).catch(console.error);
// };

// const updateUrlWithParams = (jobId, prompt, model) => {
//     const url = new URL(window.location);
//     if (jobId) {
//         url.searchParams.set("i", jobId);
//     } else {
//         url.searchParams.delete("i");
//     }
//     if (prompt) {
//         url.searchParams.set("p", prompt);
//     } else if (!jobId) {
//         // Only remove prompt if we're also removing job ID
//         url.searchParams.delete("p");
//     }
//     if (model) {
//         url.searchParams.set("m", model);
//     } else {
//         // Keep the model parameter unless explicitly cleared
//         const currentModel = url.searchParams.get("m");
//         if (!currentModel) {
//             url.searchParams.set("m", elements.workflowSelect.value);
//         }
//     }
//     url.searchParams.set("ar", elements.aspectRatioSelect.value);
//     window.history.pushState({}, "", url);
// };

// const checkDirectImageAccess = async (jobId) => {
//     try {
//         const response = await fetch(`/output/${jobId}.png`, {
//             method: "HEAD", // Use HEAD request to check existence without downloading
//         });

//         if (response.ok) {
//             // Image exists, display it with expiring message
//             displayImage(`/output/${jobId}.png`);
//             updateProgress(config.EXPIRING_PROGRESS_STATE);
//             setLoading(false); // Enable the generate button
//             clearInterval(pollingInterval); // Clear any existing polling
//             return true;
//         }
//         return false;
//     } catch (error) {
//         console.error(error);
//         return false;
//     }
// };

// const startPolling = (jobId) => {
//     currentJobId = jobId;
//     if (pollingInterval) clearInterval(pollingInterval);
//     setLoading(true);
//     hidePlaceholder();
//     hideError();
//     elements.generatedImage.style.display = "none";
//     elements.imagePlaceholder.style.display = "flex";
//     elements.loadingSpinner.style.display = "flex";
//     elements.placeholderText.style.display = "none";
//     pollingInterval = setInterval(() => pollStatus(jobId), 2000);
// };

// const pollStatus = async (jobId) => {
//     try {
//         const response = await getJobStatus(jobId);

//         switch (response.status) {
//             case "IN_QUEUE":
//                 updateProgress(config.QUEUED_PROGRESS_STATE);
//                 break;
//             case "IN_PROGRESS":
//                 updateProgress(utils.extractProgress(response));
//                 break;
//             case "COMPLETED":
//                 if (response.output === "ERROR") {
//                     throw new Error(response.error || "Generation failed");
//                 }
//                 updateProgress(config.COMPLETED_PROGRESS_STATE);
//                 clearInterval(pollingInterval);
//                 setLoading(false);
//                 hidePlaceholder();
//                 if (typeof response.output === "string") {
//                     displayImage(response.output);
//                 }
//                 break;
//             case "FAILED":
//                 throw new Error(response.error || "Generation failed");
//         }
//     } catch (error) {
//         let errorMessage = config.DEFAULT_ERROR_MESSAGE;

//         // Check specifically for WAF throttling
//         if (utils.isFirewallThrottlingError(error)) {
//             errorMessage = config.FIREWALL_THROTTLING_ERROR_MESSAGE;
//         } else if (utils.is404Error(error)) {
//             if (config.CHECK_BUCKET_FIRST) {
//                 errorMessage = "Image not found! Images expire after a day.";
//             } else {
//                 // If the SDK throws a 404 error, try direct image access
//                 const imageExists = await checkDirectImageAccess(jobId);
//                 if (!imageExists) {
//                     errorMessage =
//                         "Image not found! Images expire after a day.";
//                 }
//             }
//         }

//         console.error(error);
//         clearInterval(pollingInterval);
//         setLoading(false);
//         showPlaceholder();
//         showError(errorMessage);
//         updateUrlWithParams(null);
//     }
// };

// const generateImageHandler = async () => {
//     const prompt = elements.promptInput.value.trim();
//     if (!prompt) return;

//     resetProgressSection();
//     setLoading(true);
//     hidePlaceholder();
//     hideError();
//     elements.generatedImage.style.display = "none";
//     elements.imagePlaceholder.style.display = "flex";
//     elements.loadingSpinner.style.display = "flex";
//     elements.placeholderText.style.display = "none";

//     try {
//         const response = await generateImage(
//             prompt,
//             elements.workflowSelect.value,
//             elements.aspectRatioSelect.value
//         );

//         updateUrlWithParams(response.id, prompt, elements.workflowSelect.value);
//         startPolling(response.id);
//     } catch (error) {
//         console.error("Error generating image:", error);
//         setLoading(false);
//         showPlaceholder();
//         let errorMessage = config.DEFAULT_ERROR_MESSAGE;
//         // Check specifically for WAF throttling
//         if (utils.isFirewallThrottlingError(error)) {
//             errorMessage = config.FIREWALL_THROTTLING_ERROR_MESSAGE;
//         }
//         showError(errorMessage);
//     }
// };

// const loadParamsFromUrl = async () => {
//     const urlParams = new URLSearchParams(window.location.search);
//     const jobId = urlParams.get("i");
//     const prompt = urlParams.get("p");
//     const model = urlParams.get("m");
//     const aspectRatio = urlParams.get("ar");

//     if (prompt) {
//         elements.promptInput.value = decodeURIComponent(prompt);
//     }

//     if (model && config.WORKFLOWS.some((w) => w.param === model)) {
//         elements.workflowSelect.value = model;
//     }

//     if (aspectRatio) {
//         elements.aspectRatioSelect.value = aspectRatio;
//     }

//     if (jobId) {
//         if (config.CHECK_BUCKET_FIRST) {
//             // Try to load image directly first
//             const imageExists = await checkDirectImageAccess(jobId);
//             if (!imageExists) {
//                 // If direct image access fails, start polling
//                 startPolling(jobId);
//             }
//         } else {
//             startPolling(jobId);
//         }
//     } else {
//         showPlaceholder();
//     }
// };

// /* app initialization */
// elements.generateBtn.addEventListener("click", generateImageHandler);
// elements.promptInput.addEventListener("keypress", (event) => {
//     if (event.key === "Enter" && !elements.generateBtn.disabled) {
//         generateImageHandler();
//     }
// });

// // Handle selection changes
// elements.workflowSelect.addEventListener("change", () => {
//     updateUrlWithParams(
//         currentJobId,
//         elements.promptInput.value,
//         elements.workflowSelect.value
//     );
// });
// elements.aspectRatioSelect.addEventListener("change", () => {
//     updateUrlWithParams(
//         currentJobId,
//         elements.promptInput.value,
//         elements.workflowSelect.value
//     );
// });

// // Handle browser back/forward navigation
// window.addEventListener("popstate", () => {
//     loadParamsFromUrl();
// });

// // Populate options
// const populateSelectOptions = (
//     select,
//     options,
//     defaultValue,
//     valueKey = "param",
//     textKey = "name"
// ) => {
//     options.forEach((option) => {
//         const existingOption = select.querySelector(
//             `option[value="${option[valueKey]}"]`
//         );
//         if (existingOption) {
//             select.removeChild(existingOption);
//         }
//         const newOption = document.createElement("option");
//         newOption.value = option[valueKey];
//         newOption.textContent = option[textKey];
//         if (newOption.value === defaultValue) {
//             newOption.selected = true;
//         }
//         select.appendChild(newOption);
//     });
// };
// const initializeDropdowns = () => {
//     populateSelectOptions(
//         elements.workflowSelect,
//         config.WORKFLOWS,
//         config.DEFAULT_WORKFLOW
//     );
//     populateSelectOptions(
//         elements.aspectRatioSelect,
//         config.ASPECT_RATIOS,
//         config.DEFAULT_ASPECT_RATIO
//     );
// };

// // Main method
// const main = () => {
//     initializeDropdowns();
//     loadParamsFromUrl();
//     initializeApi();
// };

// // Entry point
// if (document.readyState === "loading") {
//     document.addEventListener("DOMContentLoaded", () => main());
// } else {
//     main();
// }

// Import HLS.js (make sure to install via npm: npm install hls.js)
import Hls from "hls.js";

class VideoStreamPlayer {
    constructor() {
        this.hls = null;
        this.video = null;
        this.isLoading = false;
        this.stats = {
            bytesLoaded: 0,
            networkSpeed: 0,
            bufferLength: 0,
        };

        this.initializeElements();
        this.bindEvents();
        this.startStatsUpdate();
    }

    initializeElements() {
        this.video = document.getElementById("video-player");
        this.loadBtn = document.getElementById("load-video");
        this.playlistInput = document.getElementById("playlist-url");
        this.loadingOverlay = document.getElementById("loading-overlay");
        this.loadingText = document.getElementById("loading-text");
        this.errorMessage = document.getElementById("error-message");
        this.qualitySelector = document.getElementById("quality-selector");
        this.qualitySelect = document.getElementById("quality-select");

        // Status elements
        this.statusValue = document.getElementById("status-value");
        this.formatValue = document.getElementById("format-value");
        this.resolutionValue = document.getElementById("resolution-value");
        this.bufferValue = document.getElementById("buffer-value");
        this.speedValue = document.getElementById("speed-value");
    }

    bindEvents() {
        this.loadBtn.addEventListener("click", () => this.loadVideo());
        this.playlistInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") this.loadVideo();
        });
        this.qualitySelect.addEventListener("change", (e) =>
            this.changeQuality(e.target.value)
        );

        // Video events
        this.video.addEventListener("loadstart", () =>
            this.updateStatus("Loading...")
        );
        this.video.addEventListener("canplay", () => this.onVideoReady());
        this.video.addEventListener("playing", () =>
            this.updateStatus("Playing")
        );
        this.video.addEventListener("pause", () => this.updateStatus("Paused"));
        this.video.addEventListener("ended", () => this.updateStatus("Ended"));
        this.video.addEventListener("error", (e) => this.onVideoError(e));
        this.video.addEventListener("waiting", () =>
            this.updateStatus("Buffering...")
        );
    }

    async loadVideo() {
        const playlistUrl = this.playlistInput.value.trim();

        if (!playlistUrl) {
            this.showError("Please enter a playlist URL");
            return;
        }

        if (!this.isValidUrl(playlistUrl)) {
            this.showError("Please enter a valid URL");
            return;
        }

        this.hideError();
        this.showLoading("Loading video stream...");
        this.loadBtn.disabled = true;

        try {
            await this.initializeHLS(playlistUrl);
        } catch (error) {
            this.showError(`Failed to load video: ${error.message}`);
            this.hideLoading();
            this.loadBtn.disabled = false;
        }
    }

    async initializeHLS(playlistUrl) {
        // Destroy existing HLS instance
        if (this.hls) {
            this.hls.destroy();
        }

        if (Hls.isSupported()) {
            this.hls = new Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90,
                maxBufferLength: 60,
                maxMaxBufferLength: 120,
                startLevel: -1, // Auto quality selection
                capLevelToPlayerSize: true,
                // Progressive loading settings
                progressive: true,
                manifestLoadingTimeOut: 20000,
                manifestLoadingMaxRetry: 3,
                levelLoadingTimeOut: 20000,
                levelLoadingMaxRetry: 3,
                fragLoadingTimeOut: 20000,
                fragLoadingMaxRetry: 3,
            });

            this.bindHLSEvents();
            this.hls.loadSource(playlistUrl);
            this.hls.attachMedia(this.video);
        } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
            // Native HLS support (Safari)
            this.video.src = playlistUrl;
            this.updateStatus("Loading (Native HLS)...");
            this.formatValue.textContent = "HLS (Native)";
        } else {
            throw new Error("HLS is not supported in this browser");
        }
    }

    bindHLSEvents() {
        this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            this.onManifestParsed(data);
        });

        this.hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            this.onLevelLoaded(data);
        });

        this.hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            this.onFragmentLoaded(data);
        });

        this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            this.onLevelSwitched(data);
        });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            this.onHLSError(data);
        });
    }

    onManifestParsed(data) {
        console.log("Manifest parsed, levels:", data.levels);
        this.formatValue.textContent = "HLS";
        this.updateQualitySelector(data.levels);
        this.updateStatus("Ready to play");
    }

    onLevelLoaded(data) {
        console.log("Level loaded:", data.details);
        this.hideLoading();
        this.loadBtn.disabled = false;
    }

    onFragmentLoaded(data) {
        this.stats.bytesLoaded += data.frag.loaded || 0;
        this.updateNetworkSpeed(data);
    }

    onLevelSwitched(data) {
        const level = this.hls.levels[data.level];
        if (level) {
            this.resolutionValue.textContent = `${level.width}x${
                level.height
            } @ ${Math.round(level.bitrate / 1000)}kbps`;
        }
    }

    onVideoReady() {
        this.hideLoading();
        this.loadBtn.disabled = false;
        this.updateStatus("Ready");

        // Auto-play if user wants it (be careful with browser policies)
        // this.video.play().catch(e => console.log('Auto-play prevented:', e));
    }

    onVideoError(event) {
        console.error("Video error:", event);
        this.showError("Video playback error occurred");
        this.hideLoading();
        this.loadBtn.disabled = false;
    }

    onHLSError(data) {
        console.error("HLS error:", data);

        if (data.fatal) {
            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    this.showError(
                        "Network error: Failed to load video segments"
                    );
                    this.hls.startLoad();
                    break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                    this.showError("Media error: Video format not supported");
                    this.hls.recoverMediaError();
                    break;
                default:
                    this.showError(`Fatal error: ${data.details}`);
                    break;
            }
        } else {
            console.warn("Non-fatal HLS error:", data.details);
        }
    }

    updateQualitySelector(levels) {
        this.qualitySelect.innerHTML =
            '<option value="-1">Auto Quality</option>';

        levels.forEach((level, index) => {
            const option = document.createElement("option");
            option.value = index;
            option.textContent = `${level.height}p (${Math.round(
                level.bitrate / 1000
            )}kbps)`;
            this.qualitySelect.appendChild(option);
        });

        this.qualitySelector.style.display = "block";
    }

    changeQuality(levelIndex) {
        if (this.hls) {
            this.hls.currentLevel = parseInt(levelIndex);
            console.log("Quality changed to level:", levelIndex);
        }
    }

    updateNetworkSpeed(data) {
        if (data.frag && data.frag.loaded && data.frag.duration) {
            const speedBps = data.frag.loaded / (data.frag.loadDuration / 1000);
            this.stats.networkSpeed = speedBps;

            const speedMbps = ((speedBps * 8) / 1000000).toFixed(1);
            this.speedValue.textContent = `${speedMbps} Mbps`;
        }
    }

    startStatsUpdate() {
        setInterval(() => {
            this.updateBufferInfo();
        }, 1000);
    }

    updateBufferInfo() {
        if (this.video && this.video.buffered.length > 0) {
            const currentTime = this.video.currentTime;
            const bufferedEnd = this.video.buffered.end(
                this.video.buffered.length - 1
            );
            const bufferLength = bufferedEnd - currentTime;

            this.stats.bufferLength = bufferLength;
            this.bufferValue.textContent = `${bufferLength.toFixed(1)}s`;
        }
    }

    showLoading(text = "Loading...") {
        this.isLoading = true;
        this.loadingText.textContent = text;
        this.loadingOverlay.classList.remove("hidden");
    }

    hideLoading() {
        this.isLoading = false;
        this.loadingOverlay.classList.add("hidden");
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.style.display = "block";
        this.updateStatus("Error");
    }

    hideError() {
        this.errorMessage.style.display = "none";
    }

    updateStatus(status) {
        this.statusValue.textContent = status;
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    // Public methods for external control
    play() {
        return this.video.play();
    }

    pause() {
        this.video.pause();
    }

    seek(time) {
        this.video.currentTime = time;
    }

    setVolume(volume) {
        this.video.volume = Math.max(0, Math.min(1, volume));
    }

    getCurrentTime() {
        return this.video.currentTime;
    }

    getDuration() {
        return this.video.duration;
    }

    destroy() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }
}

// Initialize player when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    // Check if HLS.js is available
    if (!window.Hls && typeof Hls === "undefined") {
        console.error(
            "HLS.js not found. Please install it: npm install hls.js"
        );
        document.getElementById("error-message").textContent =
            "HLS.js library not found. Please check your build configuration.";
        document.getElementById("error-message").style.display = "block";
        return;
    }

    window.videoPlayer = new VideoStreamPlayer();
    console.log("Video Stream Player initialized");
});

// Export for webpack
export default VideoStreamPlayer;
