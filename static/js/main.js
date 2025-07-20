import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import Hls from "hls.js";

import * as themeSystem from "./theme/system.js";
import { CONFIG } from "./config/config.js";
import { utf8ToBase64, base64ToUtf8 } from "./util/utils.js";

class MediaLibraryApp {
    constructor() {
        this.currentUser = null;
        this.cognitoIdentityClient = null;
        this.credentials = null;
        this.currentCredentialsProvider = null;
        this.currentLibraryOwner = null;
        this.currentLibraryData = null;
        this.libraries = [];
        this.currentMovie = null;
        this.videoPlayer = null;
        this.hls = null;
        this.playlistUrl = null;
        this.recoveryPosition = 0;
        this.retryState = {
            attempts: 0,
            phase: "initial", // 'initial', 'first_retry_cycle', 'second_retry_cycle', 'failed'
            isRetrying: false,
        };

        this.showStatusTimeout = null;
        this.lastSavedPosition = 0;
        this.positionSaveInterval = 20000;
        this.statusPollingInterval = null;
        this.isPollingStatus = false;
        this.lastStatusResponse = null;
        this.isStreamError = false;
        this.selectedSubtitleTrack = -1;

        this.initializeEventListeners();
        this.showLoadingView();
        this.checkExistingSession();

        // Add popstate listener for browser back/forward
        window.addEventListener("popstate", () => {
            const urlParams = this.parseUrl();
            this.navigateToPage(urlParams);
        });
    }

    initializeEventListeners() {
        // Auth buttons
        document
            .getElementById("login-btn")
            .addEventListener("click", () => this.handleLogin());
        document
            .getElementById("show-signup-btn")
            .addEventListener("click", () => this.showSignupView());
        document
            .getElementById("show-signin-btn")
            .addEventListener("click", () => this.showSigninView());
        document
            .getElementById("back-to-signin-btn")
            .addEventListener("click", () => this.showSigninView());
        document
            .getElementById("signup-btn")
            .addEventListener("click", () => this.handleSignup());
        document
            .getElementById("verify-btn")
            .addEventListener("click", () => this.handleVerification());
        document
            .getElementById("resend-code-btn")
            .addEventListener("click", () => this.resendVerificationCode());
        document
            .getElementById("goto-verify-btn")
            .addEventListener("click", () => this.showVerificationView());
        document
            .getElementById("logout-btn-library")
            .addEventListener("click", () => this.handleLogout());
        document
            .getElementById("logout-btn-libraries")
            .addEventListener("click", () => this.handleLogout());
        document
            .getElementById("logout-btn-movie")
            .addEventListener("click", () => this.handleLogout());

        // Navigation buttons
        document
            .getElementById("back-to-libraries-btn")
            .addEventListener("click", () => {
                this.currentLibraryOwner = null; // Clear current library owner
                this.currentLibraryData = null; // Clear library data
                this.showLibrariesView();
                this.clearLibraryPageContent();
                this.clearMoviePageContent();
                this.updateMovieDescription();
            });
        document
            .getElementById("back-to-library-btn")
            .addEventListener("click", () => {
                this.showLibraryView(this.currentLibraryOwner);
                this.clearMoviePageContent();
                this.updateMovieDescription();
            });

        // Library sharing
        document
            .getElementById("share-library-btn")
            .addEventListener("click", () => this.shareLibrary());
        document
            .getElementById("refresh-shared-users-btn")
            .addEventListener("click", () => this.loadSharedUsers());

        // Enter key handlers
        document
            .getElementById("password")
            .addEventListener("keypress", (e) => {
                if (e.key === "Enter") this.handleLogin();
            });
        document
            .getElementById("signup-password")
            .addEventListener("keypress", (e) => {
                if (e.key === "Enter") this.handleSignup();
            });
        document
            .getElementById("verification-code")
            .addEventListener("keypress", (e) => {
                if (e.key === "Enter") this.handleVerification();
            });
    }

    savePlaybackPosition(movieId, position) {
        const key = `moviePosition_${movieId}`;
        localStorage.setItem(key, position.toString());
        this.lastSavedPosition = position;
    }

    getSavedPlaybackPosition(movieId) {
        const key = `moviePosition_${movieId}`;
        const saved = localStorage.getItem(key);
        return saved ? parseFloat(saved) : 0;
    }

    startPositionTracking(movieId) {
        this.stopPositionTracking(); // Clear any existing interval

        this.positionSaveInterval = setInterval(() => {
            const video = document.getElementById("video-player");
            if (video && !video.paused && video.currentTime > 0) {
                // Only save if position changed significantly (avoid excessive saves)
                if (Math.abs(video.currentTime - this.lastSavedPosition) > 5) {
                    console.log(
                        `Saving position as ${video.currentTime} for movie ${movieId}`
                    );
                    this.savePlaybackPosition(movieId, video.currentTime);
                }
            }
        }, this.positionSaveInterval); // Save every 30 seconds
    }

    stopPositionTracking() {
        if (this.positionSaveInterval) {
            clearInterval(this.positionSaveInterval);
            this.positionSaveInterval = null;
        }
    }

    showStatus(message, type = "info") {
        const statusElement = document.getElementById("status-message");
        statusElement.textContent = message;
        // statusElement.style.display = "block";
        statusElement.style.opacity = 1;

        // Auto-hide after 5 seconds
        if (this.showStatusTimeout) {
            clearTimeout(this.showStatusTimeout);
        }

        this.showStatusTimeout = setTimeout(() => {
            // statusElement.style.display = "none";
            statusElement.style.opacity = 0;
            this.showStatusTimeout = null;
        }, 5000);
    }

    showSigninView() {
        this.hideAllViews();
        document.getElementById("signin-view").style.display = "block";
        if (this.currentUser) this.updateUrl("signin");
    }

    showSignupView() {
        this.hideAllViews();
        document.getElementById("signup-view").style.display = "block";
        this.updateUrl("signup");
    }

    showVerificationView() {
        this.hideAllViews();
        document.getElementById("verification-view").style.display = "block";
        this.updateUrl("verify");
    }

    showLibrariesView(checkLibraryAccess = false) {
        this.hideAllViews();
        document.getElementById("libraries-view").style.display = "block";
        this.updateAccountSection();
        this.loadLibraries(checkLibraryAccess);
        this.updateUrl("libraries");
    }

    showLibraryView(ownerIdentityId) {
        this.hideAllViews();
        this.currentLibraryOwner = ownerIdentityId;
        document.getElementById("library-view").style.display = "block";
        this.updateAccountSection();
        this.loadLibraryData();
        this.updateUrl("library", { libraryOwner: ownerIdentityId });

        // Show/hide library management section based on ownership
        const isOwner = this.currentUser.identityId === ownerIdentityId;
        const managementSection = document.getElementById(
            "library-management-section"
        );
        if (isOwner) {
            managementSection.style.display = "block";
            this.loadSharedUsers();
        } else {
            managementSection.style.display = "none";
        }
    }

    showMovieView(movie) {
        this.hideAllViews();
        this.currentMovie = movie;
        document.getElementById("movie-view").style.display = "block";
        document.getElementById("movie-title").textContent =
            movie.name || "Unknown Title";

        // Update movie details
        document.getElementById("movie-year").textContent =
            movie.year || "Unknown";
        document.getElementById("movie-runtime").textContent =
            movie.runtime || "Unknown";
        document.getElementById("movie-quality").textContent =
            movie.quality || "Unknown";

        this.updateAccountSection();

        // Load movie metadata
        this.loadMovieMetadata(movie);

        // Show play button instead of auto-loading video
        this.showPlayButton();

        const movieId = this.getMovieId(movie);
        this.updateUrl("movie", {
            libraryOwner: this.currentLibraryOwner,
            movieId: movieId,
        });
    }

    showMovieStatusBar() {
        const statusBar = document.getElementById("movie-status-bar");
        if (statusBar) {
            statusBar.classList.remove("hidden");
        }
    }

    hideMovieStatusBar() {
        const statusBar = document.getElementById("movie-status-bar");
        if (statusBar) {
            statusBar.classList.add("hidden");
        }
    }

    resetMovieStatusBar() {
        const messageEl = document.getElementById("status-message-text");
        const percentageEl = document.getElementById("status-percentage");
        const progressFillEl = document.getElementById("status-progress-fill");
        const etaEl = document.getElementById("status-eta");
        const stageEl = document.getElementById("status-stage");
        const statusBar = document.getElementById("movie-status-bar");

        if (!messageEl || !percentageEl || !progressFillEl) return;

        // Reset all status bar content to default values
        messageEl.textContent = "Processing movie...";
        percentageEl.textContent = "0%";
        progressFillEl.style.width = "0%";
        etaEl.textContent = "";
        stageEl.textContent = "";

        // Remove any processing animations
        if (statusBar) {
            statusBar.classList.remove("processing");
        }

        console.log("Movie status bar reset");
    }

    hideAllViews() {
        const views = [
            "loading-view",
            "signin-view",
            "signup-view",
            "verification-view",
            "libraries-view",
            "library-view",
            "movie-view",
        ];
        views.forEach((view) => {
            document.getElementById(view).style.display = "none";
        });
    }

    showLoadingView() {
        this.hideAllViews();
        document.getElementById("loading-view").style.display = "block";
    }

    updateAccountSection() {
        const accountElements = document.querySelectorAll(
            ".account-section-content"
        );
        accountElements.forEach((element) => {
            element.innerHTML = `
                <p>${this.currentUser.username}</p>
                <p>(${this.currentUser.email})</p>
            `;
        });
    }

    async checkExistingSession() {
        try {
            const accessToken = localStorage.getItem("accessToken");
            const idToken = localStorage.getItem("idToken");
            const refreshToken = localStorage.getItem("refreshToken");

            if (accessToken && idToken) {
                // Validate token (basic check - in production, verify expiration)
                const payload = JSON.parse(base64ToUtf8(idToken.split(".")[1]));
                const now = Math.floor(Date.now() / 1000);

                if (payload.exp > now) {
                    await this.handleSuccessfulLogin(
                        accessToken,
                        idToken,
                        refreshToken
                    );
                    return;
                }
            }
        } catch (error) {
            console.log("No valid existing session found");
        }

        // If not signed in, show signin view
        this.showSigninView();
        this.updateUrl("signin");
    }

    async handleLogin(fromVerify = false) {
        let username = document.getElementById("username").value.trim();
        let password = document.getElementById("password").value;
        if (fromVerify) {
            username = document
                .getElementById("verification-username")
                .value.trim();
            password = document.getElementById("verification-password").value;
        }

        if (!username || !password) {
            this.showStatus("Please enter both username and password");
            return;
        }

        const loginBtn = document.getElementById("login-btn");
        const originalText = loginBtn.textContent;
        loginBtn.textContent = "Signing In...";
        loginBtn.disabled = true;

        try {
            const response = await this.authenticateUser(username, password);
            await this.handleSuccessfulLogin(
                response.AuthenticationResult.AccessToken,
                response.AuthenticationResult.IdToken,
                response.AuthenticationResult.RefreshToken
            );
        } catch (error) {
            console.error("Login error:", error);
            this.showStatus(this.getErrorMessage(error));
        } finally {
            loginBtn.textContent = originalText;
            loginBtn.disabled = false;
            this.clearPasswordInputs();
        }
    }

    async handleSignup() {
        const username = document
            .getElementById("signup-username")
            .value.trim();
        const email = document.getElementById("signup-email").value.trim();
        const password = document.getElementById("signup-password").value;

        if (!username) {
            this.showStatus("Please choose a username");
            return;
        }
        if (!email) {
            this.showStatus("Please enter your email");
            return;
        }
        if (!password) {
            this.showStatus("Please choose a password");
            return;
        }

        const signupBtn = document.getElementById("signup-btn");
        const originalText = signupBtn.textContent;
        signupBtn.textContent = "Creating Account...";
        signupBtn.disabled = true;

        try {
            await this.signUpUser(username, email, password);
            document.getElementById("verification-username").value = username;
            document.getElementById("verification-password").value = password;
            this.showVerificationView();
            this.showStatus(
                "Account created! Please check your email for verification code."
            );
        } catch (error) {
            console.error("Signup error:", error);
            this.showStatus(this.getErrorMessage(error));
        } finally {
            signupBtn.textContent = originalText;
            signupBtn.disabled = false;
        }
    }

    async handleVerification() {
        const username = document
            .getElementById("verification-username")
            .value.trim();
        const password = document.getElementById("verification-password").value;
        const code = document.getElementById("verification-code").value.trim();

        if (!username) {
            this.showStatus("Please enter your current username");
            return;
        }
        if (!password) {
            this.showStatus("Please enter your current password");
            return;
        }
        if (!code) {
            this.showStatus("Please enter the verification code");
            return;
        }

        const verifyBtn = document.getElementById("verify-btn");
        const originalText = verifyBtn.textContent;
        verifyBtn.textContent = "Verifying...";
        verifyBtn.disabled = true;

        try {
            await this.confirmSignUp(username, code);
            await this.handleLogin(true);
            try {
                await this.initializeUserLibrary();
            } catch (libraryError) {
                console.error("Library initialization failed:", libraryError);
                // Don't fail the entire verification - they can still use the app
            }
            this.showStatus("Email verified successfully!");
            // After successful verification, go to libraries
            setTimeout(
                (() => {
                    this.showLibrariesView();
                    this.updateUrl("libraries");
                }).bind(this),
                5000
            );
        } catch (error) {
            console.error("Verification error:", error);
            this.showStatus(this.getErrorMessage(error));
        } finally {
            verifyBtn.textContent = originalText;
            verifyBtn.disabled = false;
            this.clearPasswordInputs();
        }
    }

    clearPasswordInputs() {
        document.getElementById("password").value = "";
        document.getElementById("signup-password").value = "";
        document.getElementById("verification-password").value = "";
    }

    async resendVerificationCode() {
        const username = document
            .getElementById("verification-username")
            .value.trim();
        if (!username) {
            this.showStatus("Please enter your current username");
            return;
        }

        try {
            await this.resendConfirmationCode(username);
            this.showStatus("Verification code resent to your email");
        } catch (error) {
            console.error("Resend error:", error);
            this.showStatus(this.getErrorMessage(error));
        }
    }

    async handleSuccessfulLogin(accessToken, idToken, refreshToken) {
        // Store tokens
        localStorage.setItem("accessToken", accessToken);
        localStorage.setItem("idToken", idToken);
        localStorage.setItem("refreshToken", refreshToken);

        // Parse user info from ID token
        const payload = JSON.parse(base64ToUtf8(idToken.split(".")[1]));
        this.currentUser = {
            username: payload["cognito:username"],
            email: payload.email,
            sub: payload.sub,
            idToken: idToken,
            accessToken: accessToken,
        };

        // Initialize AWS credentials
        await this.initializeAwsCredentials(idToken);

        // Get Identity ID
        this.currentUser.identityId = null;
        const identityId = await this.getIdentityId();
        this.currentUser.identityId = identityId;

        // Check URL for navigation
        const urlParams = this.parseUrl();
        if (
            urlParams.page &&
            urlParams.page !== "signin" &&
            urlParams.page !== "signup" &&
            urlParams.page !== "verify"
        ) {
            this.navigateToPage(urlParams);
        } else {
            this.showLibrariesView(true);
            this.updateUrl("libraries");
        }

        this.showStatus("Successfully signed in!");
    }

    async ensureLibraryExists() {
        try {
            const identityId = await this.getIdentityId();
            // Check if library access exists
            await this.makeAuthenticatedRequest(
                "GET",
                `/libraries/${identityId}/access`
            );
        } catch (error) {
            if (error.statusCode === 404) {
                // Library doesn't exist, initialize it
                await this.initializeUserLibrary();
                console.log("Library initialized on login (fallback)");
            } else if (error.statusCode === 403) {
                // This shouldn't happen since we're checking our own library
                console.error(
                    "Access denied to own library - this shouldn't happen"
                );
            } else {
                // For other errors (500, network issues, etc.), assume library exists
                console.log(
                    "Library check failed with status:",
                    error.statusCode || "unknown",
                    "- assuming library exists"
                );
            }
        }
    }

    async initializeUserLibrary() {
        const DEFAULT_LAST_SCAN_AT = "2000-01-01T00:00:00.000Z";
        try {
            // Get Identity ID
            const ownerIdentityId = await this.getIdentityId();

            // Make the API call to initialize library
            await this.makeAuthenticatedRequest(
                "POST",
                `/libraries/${ownerIdentityId}/access`,
                {
                    ownerUsername: this.currentUser.username,
                    movieCount: 0,
                    collectionCount: 0,
                    lastScanAt: DEFAULT_LAST_SCAN_AT,
                }
            );

            console.log("User library initialized successfully");
        } catch (error) {
            console.error("Error initializing user library:", error);
            // Don't throw - verification was successful, library init is secondary
            if (error.statusCode === 409) {
                // Library already exists - this is fine
                console.log("Library already exists");
            } else if (error.statusCode === 401) {
                console.error(
                    "Authentication failed during library initialization"
                );
            } else {
                console.error(
                    "Unexpected error during library initialization:",
                    error.statusCode
                );
            }
        }
    }

    async initializeAwsCredentials(idToken) {
        try {
            this.cognitoIdentityClient = new CognitoIdentityClient({
                region: CONFIG.region,
            });

            this.credentials = fromCognitoIdentityPool({
                identityPoolId: CONFIG.identityPoolId,
                logins: {
                    [`cognito-idp.${CONFIG.region}.amazonaws.com/${CONFIG.userPoolId}`]:
                        idToken,
                },
                client: this.cognitoIdentityClient,
            });

            // Test the credentials
            await this.getFreshCredentials();
            console.log("AWS credentials initialized successfully");
        } catch (error) {
            console.error("Error initializing AWS credentials:", error);
            throw error;
        }
    }

    async getIdentityId() {
        if (this.currentUser.identityId) {
            return this.currentUser.identityId;
        }

        try {
            if (!this.currentCredentialsProvider) {
                await this.getFreshCredentials();
            }
            this.currentUser.identityId =
                this.currentCredentialsProvider.identityId;
            return this.currentUser.identityId;
        } catch (error) {
            console.error("Error getting Identity ID:", error);
            throw error;
        }
    }

    handleLogout() {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("idToken");
        localStorage.removeItem("refreshToken");
        this.currentUser = null;
        this.credentials = null;
        this.currentLibraryOwner = null;
        this.currentLibraryData = null;
        this.libraries = [];
        this.stopPositionTracking();
        this.showSigninView();
        this.showStatus("Successfully signed out");
        this.clearContentSections();
    }

    async getFreshCredentials() {
        this.currentCredentialsProvider = await this.credentials();
        return this.currentCredentialsProvider;
    }

    async makeAuthenticatedRequest(method, path, body = null) {
        if (!this.credentials) {
            throw new Error("Not authenticated - no AWS credentials available");
        }

        try {
            // Get fresh credentials
            const awsCredentials = await this.getFreshCredentials();

            if (!awsCredentials) {
                throw new Error("Failed to obtain AWS credentials");
            }

            console.log("Using Identity ID:", awsCredentials.identityId);

            // Parse the API endpoint URL
            const apiUrl = new URL(CONFIG.apiEndpoint);
            const hostname = apiUrl.hostname;
            const fullPath = apiUrl.pathname.replace(/\/$/, "") + path; // Remove trailing slash and add path

            // Prepare the request body
            const requestBody = body ? JSON.stringify(body) : undefined;

            // Create the HTTP request object
            const request = new HttpRequest({
                method: method,
                hostname: hostname,
                path: fullPath,
                headers: {
                    "Content-Type": "application/json",
                    Host: hostname,
                },
                body: requestBody,
            });

            console.log("Request details:", {
                method: method,
                hostname: hostname,
                path: fullPath,
                hasBody: !!requestBody,
            });

            // Create the SigV4 signer
            const signer = new SignatureV4({
                credentials: awsCredentials,
                region: CONFIG.region,
                service: "execute-api",
                sha256: Sha256,
            });

            // Sign the request
            const signedRequest = await signer.sign(request);

            console.log("Request signed successfully");

            // Convert signed request to fetch options
            const fetchOptions = {
                method: signedRequest.method,
                headers: {},
                body: signedRequest.body,
            };

            // Copy all headers from signed request
            for (const [key, value] of Object.entries(signedRequest.headers)) {
                fetchOptions.headers[key] = value;
            }

            // Make the actual HTTP request
            const fullUrl = `${apiUrl.protocol}//${hostname}${fullPath}`;
            console.log("Making request to:", fullUrl);

            const response = await fetch(fullUrl, fetchOptions);

            console.log("Response status:", response.status);
            console.log(
                "Response headers:",
                Object.fromEntries(response.headers.entries())
            );

            if (!response.ok) {
                const errorText = await response.text();
                console.error("Error response:", errorText);
                // Create error with status code property
                const error = new Error(
                    `HTTP ${response.status}: ${errorText}`
                );
                error.statusCode = response.status;
                error.responseText = errorText;
                throw error;
            }

            // Parse response based on content type
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const jsonResponse = await response.json();
                console.log("JSON response received");
                return jsonResponse;
            } else {
                const textResponse = await response.text();
                console.log(
                    "Text response received, length:",
                    textResponse.length
                );
                return textResponse;
            }
        } catch (error) {
            console.error("Request error details:", {
                message: error.message,
                stack: error.stack,
                name: error.name,
            });

            // If it's already our custom error with statusCode, re-throw it
            if (error.statusCode) {
                throw error;
            }

            // Provide more specific error messages
            if (error.message.includes("fetch")) {
                throw new Error(`Network error: ${error.message}`);
            } else if (error.message.includes("credentials")) {
                throw new Error(`Authentication error: ${error.message}`);
            } else if (error.message.includes("sign")) {
                throw new Error(`Request signing error: ${error.message}`);
            } else {
                throw error;
            }
        }
    }

    async loadLibraries(checkLibraryAccess = false) {
        try {
            let result = await this.makeAuthenticatedRequest(
                "GET",
                "/libraries"
            );
            if (!result.ownedLibrary && checkLibraryAccess === true) {
                // Ensure library is initialized (fallback for failed verification init)
                try {
                    await this.ensureLibraryExists();
                } catch (error) {
                    console.log("Failed to ensure library exists:", error);
                }
                result = await this.makeAuthenticatedRequest(
                    "GET",
                    "/libraries"
                );
            }
            this.libraries = result.ownedLibrary ? [result.ownedLibrary] : [];
            this.libraries = [...this.libraries, ...result.sharedLibraries];
            await this.displayLibraries();
        } catch (error) {
            console.error("Error loading libraries:", error);
            if (error.statusCode === 403) {
                this.showStatus("Access denied. Please sign in again.");
                this.handleLogout();
            } else if (error.statusCode === 401) {
                this.showStatus("Session expired. Please sign in again.");
                this.handleLogout();
            } else {
                this.showStatus(
                    "Error loading libraries: " +
                        (error.message || "Unknown error")
                );
            }
        }
    }

    getOwnerDescriptor(
        currentIdentityId,
        ownerIdentityId,
        ownerUsername = "Unknown"
    ) {
        if (ownerIdentityId === currentIdentityId) {
            return `${this.currentUser.username}`;
        }
        return ownerUsername;
    }

    async displayLibraries() {
        const container = document.getElementById("libraries-list");

        if (this.libraries.length === 0) {
            container.innerHTML = "<p>No libraries found.</p>";
            return;
        }

        const identityId = await this.getIdentityId();

        container.innerHTML = this.libraries
            .map(
                (library) => `
                <div>
                    <h4>${this.getOwnerDescriptor(
                        identityId,
                        library.ownerIdentityId,
                        library.ownerUsername ?? ""
                    )}'s Library</h4>
                    <button onclick="window.mediaLibraryApp.showLibraryView('${
                        library.ownerIdentityId
                    }')" >
                        View Library
                    </button>
                    <div class="section-spacer"></div>
                    <hr>
                </div>
            `
            )
            .join("");
    }

    async loadLibraryData() {
        try {
            const result = await this.makeAuthenticatedRequest(
                "GET",
                `/libraries/${this.currentLibraryOwner}/library`
            );
            this.currentLibraryData = result;
            this.displayLibraryData();
        } catch (error) {
            console.error("Error loading library data:", error);
            if (error.statusCode === 403) {
                this.showStatus("Access denied to this library");
                this.showLibrariesView();
                this.updateUrl("libraries");
            } else if (error.statusCode === 404) {
                this.currentLibraryData = null;
                this.displayLibraryData();
            } else if (error.statusCode === 401) {
                this.showStatus("Session expired. Please sign in again.");
                this.handleLogout();
            } else {
                this.showStatus(
                    "Error loading library data: " +
                        (error.message || "Unknown error")
                );
            }
        }
    }

    displayLibraryData() {
        const container = document.getElementById("library-content");

        if (
            !this.currentLibraryData ||
            Object.keys(this.currentLibraryData).length === 0
        ) {
            container.innerHTML = "<p>No movies found in this library.</p>";
            return;
        }

        // Flatten all movies from all groups into a single array
        const allMovies = [];
        Object.keys(this.currentLibraryData).forEach((collection) => {
            const moviesInCollection = this.currentLibraryData[collection];
            const collectionSize = moviesInCollection.length;

            moviesInCollection.forEach((movie) => {
                allMovies.push({
                    ...movie,
                    collection,
                    collectionSize, // Add collection size for display logic
                });
            });
        });

        // Sort movies alphabetically by name
        allMovies.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        // Store all movies for search functionality
        this.allMoviesForSearch = allMovies;

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3>Movies (${allMovies.length})</h3>
            </div>
            <div style="margin-bottom: 20px;">
                <input 
                    type="text" 
                    id="movie-search-input" 
                    placeholder="Search movies by title, year, collection..." 
                    style="
                        width: 100%; 
                        padding: 10px; 
                        border-radius: 4px; 
                        font-size: 16px;
                        box-sizing: border-box;
                    "
                />
            </div>
            <div id="movies-list">
                ${this.renderMoviesList(allMovies)}
            </div>
        `;

        // Add search functionality
        const searchInput = document.getElementById("movie-search-input");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.filterMovies(e.target.value);
            });
        }
    }

    getMoviePosterUrls(movie) {
        // First try CDN poster
        const movieId = this.getMovieId(movie);
        const cdnPosterUrl = `/poster/${this.currentLibraryOwner}/poster_${movieId}.jpg`;

        // Fallback to TMDB if available
        const tmdbPosterUrl = movie.poster_path
            ? `${CONFIG.tmdbPosterUrlPrefix300}${movie.poster_path}`
            : null;

        return { cdnPosterUrl, tmdbPosterUrl };
    }

    renderMoviePosterWithFallback(posterUrls, movieName) {
        const { cdnPosterUrl, tmdbPosterUrl } = posterUrls;

        if (cdnPosterUrl) {
            // Try CDN first, fallback to TMDB, then no poster
            if (tmdbPosterUrl) {
                return `<img src="${cdnPosterUrl}" alt="${
                    movieName || "Movie Poster"
                }" 
                            onerror="this.src='${tmdbPosterUrl}'; this.onerror=function(){this.style.display='none';}">`;
            } else {
                return `<img src="${cdnPosterUrl}" alt="${
                    movieName || "Movie Poster"
                }" 
                            onerror="this.style.display='none'">`;
            }
        } else if (tmdbPosterUrl) {
            return `<img src="${tmdbPosterUrl}" alt="${
                movieName || "Movie Poster"
            }" 
                        onerror="this.style.display='none'">`;
        } else {
            return `<div style="width: 100%; height: 100%; background: var(--progress-bg); display: flex; align-items: center; justify-content: center; color: var(--status-text);">No Poster</div>`;
        }
    }

    renderMoviesList(movies) {
        if (movies.length === 0) {
            return "<p>No movies match your search.</p>";
        }

        return `<div class="movies-grid">${movies
            .map((movie, index) => {
                const posterUrls = this.getMoviePosterUrls(movie);

                return `
                    <div class="movie-card">
                        <div class="movie-poster" onclick="window.mediaLibraryApp.showMovieView(${JSON.stringify(
                            movie
                        ).replace(/"/g, "&quot;")})">
                            ${this.renderMoviePosterWithFallback(
                                posterUrls,
                                movie.name
                            )}
                        </div>
                        <div class="movie-info">
                            <div class="movie-title">${
                                movie.name || "Unknown Title"
                            }</div>
                            <div class="movie-details">
                                <p><strong>Year:</strong> ${
                                    movie.year || "Unknown"
                                }</p>
                                <p><strong>Runtime:</strong> ${
                                    movie.runtime || "Unknown"
                                }</p>
                                <p><strong>Quality:</strong> ${
                                    movie.quality || "Unknown"
                                }</p>
                                ${
                                    movie.collectionSize > 1
                                        ? `<p><strong>Collection:</strong> ${
                                              movie.collection || "Unknown"
                                          }</p>`
                                        : ""
                                }
                            </div>
                            <button class="movie-button" onclick="window.mediaLibraryApp.showMovieView(${JSON.stringify(
                                movie
                            ).replace(/"/g, "&quot;")})">
                                Play Movie
                            </button>
                        </div>
                    </div>
                `;
            })
            .join("")}</div>`;
    }

    async loadMoviePosters() {
        if (!this.allMoviesForSearch) return;

        // Load metadata for movies that don't have posterPath yet
        const moviesNeedingPosters = this.allMoviesForSearch.filter(
            (movie) => !movie.posterPath
        );

        if (moviesNeedingPosters.length === 0) return;

        console.log(
            `Loading posters for ${moviesNeedingPosters.length} movies`
        );

        // Process movies in batches to avoid overwhelming the API
        const batchSize = 5;
        for (let i = 0; i < moviesNeedingPosters.length; i += batchSize) {
            const batch = moviesNeedingPosters.slice(i, i + batchSize);

            await Promise.all(
                batch.map(async (movie) => {
                    try {
                        const queryParams = new URLSearchParams();
                        if (movie.name) {
                            const cleanedTitle = this.cleanMovieTitleForSearch(
                                movie.name
                            );
                            queryParams.append("query", cleanedTitle);
                        }
                        if (movie.year) {
                            queryParams.append("year", movie.year);
                        }

                        const response = await fetch(
                            `${
                                CONFIG.apiEndpoint
                            }/metadata?${queryParams.toString()}`
                        );

                        if (response.ok) {
                            const result = await response.json();
                            if (result.results && result.results.length > 0) {
                                movie.posterPath =
                                    result.results[0].poster_path;
                            }
                        }
                    } catch (error) {
                        console.warn(
                            `Failed to load poster for ${movie.name}:`,
                            error
                        );
                    }
                })
            );

            // Small delay between batches to be respectful to the API
            if (i + batchSize < moviesNeedingPosters.length) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }

        // Re-render the movies list with the new poster data
        this.filterMovies(
            document.getElementById("movie-search-input")?.value || ""
        );
    }

    filterMovies(searchTerm) {
        if (!this.allMoviesForSearch) return;

        const filteredMovies = this.allMoviesForSearch.filter((movie) => {
            const searchLower = searchTerm.toLowerCase();
            const name = (movie.name || "").toLowerCase();
            const year = (movie.year || "").toString().toLowerCase();
            const quality = (movie.quality || "").toLowerCase();
            const runtime = (movie.runtime || "").toLowerCase();
            const collection = (movie.collection || "").toLowerCase();

            return (
                name.includes(searchLower) ||
                year.includes(searchLower) ||
                quality.includes(searchLower) ||
                runtime.includes(searchLower) ||
                collection.includes(searchLower)
            );
        });

        // Update the movies count in the header
        const moviesHeader = document.querySelector("#library-content h3");
        if (moviesHeader) {
            const totalCount = this.allMoviesForSearch.length;
            const filteredCount = filteredMovies.length;
            if (searchTerm.trim()) {
                moviesHeader.textContent = `Movies (${filteredCount} of ${totalCount})`;
            } else {
                moviesHeader.textContent = `Movies (${totalCount})`;
            }
        }

        // Update the movies list
        const moviesList = document.getElementById("movies-list");
        if (moviesList) {
            moviesList.innerHTML = this.renderMoviesList(filteredMovies);
        }
    }

    async shareLibrary() {
        const shareWithInput = document
            .getElementById("share-with-input")
            .value.trim();

        if (!shareWithInput) {
            this.showStatus("Please enter a username or email to share with");
            return;
        }

        // Basic validation for email format or username
        const isEmail = shareWithInput.includes("@");
        if (isEmail && !this.isValidEmail(shareWithInput)) {
            this.showStatus("Please enter a valid email address");
            return;
        }

        if (!isEmail && !this.isValidUsername(shareWithInput)) {
            this.showStatus(
                "Please enter a valid username (3-50 characters, letters, numbers, and underscores only)"
            );
            return;
        }

        const button = document.getElementById("share-library-btn");
        const originalText = button.textContent;
        button.textContent = "Sharing...";
        button.disabled = true;

        try {
            const response = await this.makeAuthenticatedRequest(
                "POST",
                `/libraries/${this.currentUser.identityId}/share`,
                {
                    ownerUsername: this.currentUser.username,
                    sharedWith: shareWithInput, // Changed from shareWithIdentityId
                }
            );

            // Show success message with resolved user info
            const sharedWithInfo = response.sharedWith;
            const successMessage = isEmail
                ? `Library shared successfully with ${sharedWithInfo.username} (${shareWithInput})!`
                : `Library shared successfully with ${sharedWithInfo.username}!`;

            this.showStatus(successMessage);
            document.getElementById("share-with-input").value = "";
            this.loadSharedUsers(); // Refresh the shared users list
        } catch (error) {
            console.error("Error sharing library:", error);

            if (error.statusCode === 400) {
                // Parse the error message for more specific feedback
                if (
                    error.responseText &&
                    error.responseText.includes("required")
                ) {
                    this.showStatus(
                        "Please provide a username or email address"
                    );
                } else {
                    this.showStatus("Invalid username or email provided");
                }
            } else if (error.statusCode === 403) {
                this.showStatus("You can only share your own library");
            } else if (error.statusCode === 404) {
                this.showStatus(
                    "User not found with the provided username or email"
                );
            } else if (error.statusCode === 401) {
                this.showStatus("Session expired. Please sign in again.");
                this.handleLogout();
            } else {
                this.showStatus(
                    "Error sharing library: " +
                        (error.message || "Unknown error")
                );
            }
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    // Helper method for email validation
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Helper method for username validation
    // isValidUsername(username) {
    //     // Assuming usernames are 3-50 characters, alphanumeric plus underscores
    //     const usernameRegex = /^[a-zA-Z0-9_]{3,50}$/;
    //     return usernameRegex.test(username);
    // }
    isValidUsername(username) {
        // More permissive validation - closer to Cognito's actual rules
        // Cognito allows most special characters in usernames
        const usernameRegex = /^[a-zA-Z0-9_.@-]{1,128}$/;
        return usernameRegex.test(username);
    }

    async loadSharedUsers() {
        try {
            const result = await this.makeAuthenticatedRequest(
                "GET",
                `/libraries/${this.currentUser.identityId}/share`
            );
            this.displaySharedUsers(result);
        } catch (error) {
            console.error("Error loading shared users:", error);

            if (error.statusCode === 403) {
                this.showStatus("Access denied");
            } else if (error.statusCode === 404) {
                this.showStatus("Library not found");
            } else if (error.statusCode === 401) {
                this.showStatus("Session expired. Please sign in again.");
                this.handleLogout();
            } else {
                this.showStatus(
                    "Error loading shared users: " +
                        (error.message || "Unknown error")
                );
            }
        }
    }

    displaySharedUsers(data) {
        const container = document.getElementById("shared-users-list");

        if (!data.sharedAccesses || data.sharedAccesses.length === 0) {
            container.innerHTML =
                "<p>No users have access to this library.</p>";
            return;
        }

        container.innerHTML = data.sharedAccesses
            .map(
                (user) => `
            <div class="shared-user-item">
                <div class="shared-user-info">
                    <p><strong>${
                        user.sharedWithUsername || "Unknown User"
                    }</strong></p>
                    <p class="shared-date">Shared: ${new Date(
                        user.sharedAt
                    ).toLocaleDateString()}</p>
                    ${
                        // user.updatedAt && user.updatedAt !==
                        // user.sharedAt
                        //     ? `<p class="updated-date">Updated: ${new Date(
                        //           user.updatedAt
                        //       ).toLocaleDateString()}</p>`
                        //     : ""
                        ""
                    }
                </div>
                <div class="shared-user-actions">
                    <button 
                        onclick="window.mediaLibraryApp.removeSharedAccess('${
                            user.sharedWithIdentityId
                        }', '${user.sharedWithUsername}')"
                        class="remove-access-btn">
                        Remove Access
                    </button>
                </div>
            </div>
        `
            )
            .join("");
    }

    async removeSharedAccess(sharedWithIdentityId, sharedWithUsername) {
        if (
            !confirm(
                `Are you sure you want to remove access for ${sharedWithUsername}?`
            )
        ) {
            return;
        }

        try {
            await this.makeAuthenticatedRequest(
                "DELETE",
                `/libraries/${this.currentUser.identityId}/share/${sharedWithIdentityId}`
            );

            this.showStatus(`Access removed for ${sharedWithUsername}`);
            this.loadSharedUsers(); // Refresh the shared users list
        } catch (error) {
            console.error("Error removing shared access:", error);

            if (error.statusCode === 403) {
                this.showStatus(
                    "You can only remove access from your own library"
                );
            } else if (error.statusCode === 404) {
                this.showStatus("Shared access not found");
            } else if (error.statusCode === 401) {
                this.showStatus("Session expired. Please sign in again.");
                this.handleLogout();
            } else {
                this.showStatus(
                    "Error removing access: " +
                        (error.message || "Unknown error")
                );
            }
        }
    }

    async loadMovieMetadata(movie) {
        try {
            const queryParams = new URLSearchParams();

            if (movie.name) {
                // Clean the movie title before searching
                const cleanedTitle = this.cleanMovieTitleForSearch(movie.name);
                queryParams.append("query", cleanedTitle);
            }

            if (movie.year) {
                queryParams.append("year", movie.year);
            }

            // Make regular fetch request without authentication
            const response = await fetch(
                `${CONFIG.apiEndpoint}/metadata?${queryParams.toString()}`
            );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${await response.text()}`
                );
            }

            const result = await response.json();
            console.log("Movie metadata:", result);
            this.updateMovieDescription(result);
        } catch (error) {
            console.error("Error loading movie metadata:", error);
            this.showStatus("Error loading movie details: " + error.message);
            this.updateMovieDescription(null);
        }
    }

    async loadMovieSubtitles(movie) {
        try {
            const movieId = this.getMovieId(movie);
            const ownerIdentityId = this.currentLibraryOwner;

            const response = await this.makeAuthenticatedRequest(
                "GET",
                `/libraries/${ownerIdentityId}/movies/${movieId}/subtitles`
            );

            console.log("Loaded subtitles:", response.subtitles);
            return response.subtitles || [];
        } catch (error) {
            console.warn("Failed to load subtitles:", error);
            return [];
        }
    }

    updateMovieDescription(metadata) {
        // Find the description paragraph in the movie view
        const descriptionParagraph =
            document.getElementById("movie-description");
        const posterContainer = document.getElementById("poster-container");

        if (metadata && metadata.results && metadata.results.length > 0) {
            // Get the first result from the API response
            const movieData = metadata.results[0];

            if (movieData.overview) {
                // Update with actual movie description
                descriptionParagraph.textContent = movieData.overview;
            } else {
                descriptionParagraph.textContent =
                    "No description available for this movie.";
            }

            if (movieData.poster_path) {
                // Clear any existing content in the poster container
                posterContainer.innerHTML = "";

                // Create the image element
                const posterImg = document.createElement("img");
                posterImg.src = `${CONFIG.tmdbPosterUrlPrefix500}${movieData.poster_path}`;
                posterImg.alt = movieData.title || "Movie Poster";
                posterImg.style.width = "100%";
                posterImg.style.height = "auto";
                posterImg.style.objectFit = "contain";
                posterImg.style.borderRadius = "4px";

                // Append the image to the poster container
                posterContainer.appendChild(posterImg);
            }
        } else {
            // Fallback if no results are available
            descriptionParagraph.textContent =
                "No description available for this movie.";
        }
    }

    // Cognito Authentication Methods (keep all existing methods)
    async authenticateUser(username, password) {
        const authData = {
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: CONFIG.userPoolWebClientId,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password,
            },
        };

        const response = await fetch(
            `https://cognito-idp.${CONFIG.region}.amazonaws.com/`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-amz-json-1.1",
                    "X-Amz-Target":
                        "AWSCognitoIdentityProviderService.InitiateAuth",
                },
                body: JSON.stringify(authData),
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Authentication failed");
        }

        return await response.json();
    }

    async signUpUser(username, email, password) {
        const signUpData = {
            ClientId: CONFIG.userPoolWebClientId,
            Username: username,
            Password: password,
            UserAttributes: [
                {
                    Name: "email",
                    Value: email,
                },
            ],
        };

        const response = await fetch(
            `https://cognito-idp.${CONFIG.region}.amazonaws.com/`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-amz-json-1.1",
                    "X-Amz-Target": "AWSCognitoIdentityProviderService.SignUp",
                },
                body: JSON.stringify(signUpData),
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Sign up failed");
        }

        return await response.json();
    }

    async confirmSignUp(username, confirmationCode) {
        const confirmData = {
            ClientId: CONFIG.userPoolWebClientId,
            Username: username,
            ConfirmationCode: confirmationCode,
        };

        const response = await fetch(
            `https://cognito-idp.${CONFIG.region}.amazonaws.com/`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-amz-json-1.1",
                    "X-Amz-Target":
                        "AWSCognitoIdentityProviderService.ConfirmSignUp",
                },
                body: JSON.stringify(confirmData),
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Confirmation failed");
        }

        return await response.json();
    }

    async resendConfirmationCode(username) {
        const resendData = {
            ClientId: CONFIG.userPoolWebClientId,
            Username: username,
        };

        const response = await fetch(
            `https://cognito-idp.${CONFIG.region}.amazonaws.com/`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-amz-json-1.1",
                    "X-Amz-Target":
                        "AWSCognitoIdentityProviderService.ResendConfirmationCode",
                },
                body: JSON.stringify(resendData),
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Resend failed");
        }

        return await response.json();
    }

    showPlayButton() {
        const playButtonOverlay = document.getElementById(
            "play-button-overlay"
        );
        const loadingOverlay = document.getElementById("loading-overlay");

        if (playButtonOverlay) {
            playButtonOverlay.classList.remove("hidden");
            playButtonOverlay.onclick = () => this.onPlayButtonClick();
        }

        if (loadingOverlay) {
            loadingOverlay.classList.add("hidden");
        }

        // Reset retry state
        this.resetRetryState();
    }

    hidePlayButton() {
        const playButtonOverlay = document.getElementById(
            "play-button-overlay"
        );
        if (playButtonOverlay) {
            playButtonOverlay.classList.add("hidden");
            playButtonOverlay.onclick = null;
        }
    }

    onPlayButtonClick() {
        this.hidePlayButton();
        this.initializeVideoPlayer(this.currentMovie);
    }

    async getMovieStreamUrl(movie) {
        if (!movie.videoFile) {
            throw new Error("No video file specified for this movie");
        }

        const movieId = this.getMovieId(movie);
        const ownerIdentityId = this.currentLibraryOwner;

        try {
            const apiResponse = await this.makeAuthenticatedRequest(
                "GET",
                `/libraries/${ownerIdentityId}/movies/${movieId}/playlist`
            );

            // Extract the pre-signed URL from the response
            return apiResponse.playlistUrl;
        } catch (error) {
            console.error("Failed to get playlist URL:", error);
            throw error;
        }
    }

    async initializeVideoPlayer(movie) {
        this.stopPositionTracking();
        this.showVideoLoading("Loading movie...");

        try {
            const playlistUrl = await this.getMovieStreamUrlWithRetry(movie);
            if (playlistUrl) {
                this.playlistUrl = playlistUrl;
                // const playlistBlobUrl = this.createPlaylistBlobUrl(playlistText);

                // Load subtitles
                const subtitles = await this.loadMovieSubtitles(movie);

                this.setupHLSPlayer(this.playlistUrl, false, subtitles);
            } else {
                console.log(
                    "getMovieStreamUrlWithRetry returned empty, will initialize video player later"
                );
            }
        } catch (error) {
            console.error("Failed to initialize video player:", error);
            this.hideVideoLoading();
            this.showPlayButton();
            this.showStatus("Error loading video: " + error.message);
        }
    }

    getMoviePathInLibrary(movie) {
        return `${movie.collection}/${movie.name} (${movie.year})/${movie.videoFile}`;
    }

    getMovieId(movie) {
        return utf8ToBase64(this.getMoviePathInLibrary(movie));
    }

    async getMovieStreamUrlWithRetry(movie) {
        const movieId = this.getMovieId(movie);
        const ownerIdentityId = this.currentLibraryOwner;

        try {
            // Single attempt to get stream URL
            return await this.getMovieStreamUrl(movie);
        } catch (error) {
            console.log(
                "Stream URL not ready, requesting processing:",
                error.message
            );

            // Request processing
            this.showVideoLoading("Waiting for movie...");

            try {
                await this.makeAuthenticatedRequest(
                    "POST",
                    `/libraries/${ownerIdentityId}/movies/${movieId}/request`
                );
                console.log("Processing request sent");

                // Show status bar and start polling
                this.showMovieStatusBar();
                this.pollMovieStatus(movie);
                this.showStatus("Waiting for movie");
            } catch (requestError) {
                console.warn(
                    "Failed to send processing request:",
                    requestError
                );
                throw new Error("Failed to start movie processing");
            }

            // Return null - status polling will handle the rest
            return null;
        }
    }

    calculateRecoveryPosition() {
        try {
            const video = document.getElementById("video-player");
            let recoveryPositionFinal = this.recoveryPosition;

            if (video && video.buffered.length > 0) {
                // Get the end time of the last buffered range
                const lastBufferedEnd = video.buffered.end(
                    video.buffered.length - 1
                );

                // Check if recovery position is within 30 seconds of the buffered end
                if (Math.abs(this.recoveryPosition - lastBufferedEnd) <= 30) {
                    // Only subtract 10 seconds if we're close to the buffered end
                    recoveryPositionFinal = Math.max(
                        this.recoveryPosition - 10,
                        0
                    );
                }
            } else {
                // Fallback: if we can't determine buffered length, use original logic with -10
                recoveryPositionFinal = Math.max(this.recoveryPosition - 10, 0);
            }

            return recoveryPositionFinal;
        } catch (e) {
            console.warn(
                "Unexpected error while calculating recovery position"
            );
            console.warn(e);
            return this.recoveryPosition;
        }
    }

    setupHLSPlayer(streamUrl, isRecovery, subtitles = []) {
        // Destroy existing player if any
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        const recoveryPositionFinal = this.calculateRecoveryPosition();
        const startPosition = isRecovery ? this.recoveryPosition : 0;

        const video = document.getElementById("video-player");
        if (!video) throw new Error("Video element not found");

        if (Hls.isSupported()) {
            this.hls = new Hls({
                debug: false,
                enableWorker: true,
                backBufferLength: 90,
                maxBufferLength: 60,
                startLevel: -1,
                capLevelToPlayerSize: true,
                startPosition,
                // VOD-specific settings:
                lowLatencyMode: false,
            });

            this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                this.hideVideoLoading();
                this.updateQualitySelector(data.levels);

                // Add subtitle tracks
                this.addSubtitleTracks(subtitles);

                // Reset retry state after successful manifest parsing
                this.resetRetryState();

                const movieId = this.getMovieId(this.currentMovie);

                setTimeout(() => {
                    if (isRecovery) {
                        video.currentTime = recoveryPositionFinal;
                        video.play().catch((error) => {
                            console.warn("Recovery autoplay failed:", error);
                        });
                    } else {
                        // Check for saved position
                        const savedPosition =
                            this.getSavedPlaybackPosition(movieId);
                        video.currentTime = savedPosition;
                        video.play().catch((error) => {
                            console.warn("Autoplay failed:", error);
                        });
                    }

                    // Start position tracking
                    this.startPositionTracking(movieId);
                }, 100);
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                console.error("HLS error:", data);
                if (this.isRetryableStreamError(data)) {
                    this.isStreamError = true;
                    this.handleStreamError(data);
                }

                // Maybe reload page when its data.fatal
            });

            this.hls.loadSource(streamUrl);
            this.hls.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = streamUrl;

            const movieId = this.getMovieId(this.currentMovie);

            if (!isRecovery) {
                video.addEventListener(
                    "loadedmetadata",
                    () => {
                        const savedPosition =
                            this.getSavedPlaybackPosition(movieId);
                        video.currentTime = savedPosition;
                        this.hideVideoLoading();
                        this.startPositionTracking(movieId);
                    },
                    { once: true }
                );
            } else {
                this.hideVideoLoading();
                this.startPositionTracking(movieId);
            }

            // For native HLS support (Safari), start playing automatically
            video.play().catch((error) => {
                console.warn("Autoplay failed:", error);
            });
        } else {
            throw new Error("Video streaming not supported in this browser");
        }
    }

    // Simplified subtitle management - only load one track at a time

    async addSelectedSubtitleTrack(trackIndex) {
        const video = document.getElementById("video-player");
        if (!video) return;

        // Remove all existing subtitle tracks
        const existingTracks = video.querySelectorAll(
            'track[kind="subtitles"]'
        );
        existingTracks.forEach((track) => {
            if (track.src.startsWith("blob:")) {
                URL.revokeObjectURL(track.src);
            }
            track.remove();
        });

        // If trackIndex is -1 (No Subtitles), just return
        if (trackIndex < 0 || trackIndex >= this.currentSubtitles.length) {
            console.log("No subtitle track selected or invalid index");
            return;
        }

        try {
            const subtitle = this.currentSubtitles[trackIndex];
            console.log(`📥 Loading subtitle: ${subtitle.language}`);

            // Fetch subtitle content
            const response = await fetch(subtitle.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch subtitle: ${response.status}`);
            }

            let vttContent = await response.text();

            // Apply offset if specified
            const offset = this.subtitleOffsets[trackIndex] || 0;
            if (offset !== 0) {
                vttContent = this.applySubtitleOffset(vttContent, offset);
                console.log(`Applied ${offset}s offset to subtitle`);
            }

            // Create track with processed content
            const blob = new Blob([vttContent], { type: "text/vtt" });
            const dataUrl = URL.createObjectURL(blob);

            const track = document.createElement("track");
            track.kind = "subtitles";
            track.src = dataUrl;
            track.srclang = subtitle.language;
            track.label = subtitle.label;
            track.setAttribute("data-index", trackIndex);

            // Add track to video
            video.appendChild(track);

            // Wait for track to load and then activate it
            return new Promise((resolve) => {
                const handleLoad = () => {
                    track.track.mode = "showing";
                    console.log(`✅ Activated subtitle: ${subtitle.language}`);
                    resolve();
                };

                const handleError = () => {
                    console.warn(
                        `Failed to load subtitle: ${subtitle.language}`
                    );
                    resolve(); // Still resolve to not block
                };

                track.addEventListener("load", handleLoad, { once: true });
                track.addEventListener("error", handleError, { once: true });

                // Fallback timeout
                setTimeout(handleLoad, 3000);
            });
        } catch (error) {
            console.error(`Failed to add subtitle track ${trackIndex}:`, error);
            throw error;
        }
    }

    async addSubtitleTracks(subtitles) {
        // Store subtitles for management
        this.currentSubtitles = subtitles;
        this.subtitleOffsets = {}; // Reset offsets
        this.selectedSubtitleTrack = -1; // Track current selection

        // Show subtitle controls if we have subtitles
        const subtitleControls = document.getElementById("subtitle-controls");
        if (subtitleControls) {
            if (subtitles.length > 0) {
                subtitleControls.style.display = "block";
                this.setupSubtitleControls();
            } else {
                subtitleControls.style.display = "none";
            }
        }

        if (subtitles.length === 0) return;

        // Find English subtitle index for default selection
        const englishLanguageCodes = ["eng", "en", "english"];
        let englishIndex = -1;

        for (let i = 0; i < subtitles.length; i++) {
            const subtitle = subtitles[i];
            const language = subtitle.language.toLowerCase();
            const label = subtitle.label.toLowerCase();

            if (
                englishLanguageCodes.includes(language) ||
                englishLanguageCodes.includes(label) ||
                label.includes("english")
            ) {
                englishIndex = i;
                break;
            }
        }

        // Setup subtitle track selector
        this.updateSubtitleTrackSelector(subtitles);

        // Auto-select English track if available, otherwise select first track
        const defaultTrack = englishIndex !== -1 ? englishIndex : 0;
        this.selectedSubtitleTrack = defaultTrack;

        // Update dropdown to show selected track
        const trackSelect = document.getElementById("subtitle-track-select");
        if (trackSelect) {
            trackSelect.value = defaultTrack.toString();
        }

        // Load the default track
        await this.addSelectedSubtitleTrack(defaultTrack);
    }

    setupSubtitleControls() {
        const offsetInput = document.getElementById("subtitle-offset");
        const applyBtn = document.getElementById("apply-subtitle-offset");
        const resetBtn = document.getElementById("reset-subtitle-offset");
        const trackSelect = document.getElementById("subtitle-track-select");

        // Load saved offset for this movie
        const defaultTrack = this.selectedSubtitleTrack;
        const savedOffset = localStorage.getItem(
            `subtitleOffset_${movieId}_${defaultTrack}`
        );
        if (savedOffset) {
            offsetInput.value = savedOffset;
        }

        // Track selector change handler
        trackSelect.onchange = async (e) => {
            const trackIndex = parseInt(e.target.value);
            this.selectedSubtitleTrack = trackIndex;

            console.log(`🎬 Switching to subtitle track: ${trackIndex}`);

            try {
                await this.addSelectedSubtitleTrack(trackIndex);

                // Update offset input with saved offset for this track
                const savedOffset =
                    localStorage.getItem(
                        `subtitleOffset_${movieId}_${trackIndex}`
                    ) || 0;
                const offset = parseFloat(savedOffset);
                this.subtitleOffsets[trackIndex] = offset;
                offsetInput.value = offset.toString();
            } catch (error) {
                console.error("Failed to switch subtitle track:", error);
                this.showStatus("Failed to load subtitle track");
            }
        };

        // Apply offset button
        applyBtn.onclick = async () => {
            const offset = parseFloat(offsetInput.value) || 0;
            const selectedTrack = this.selectedSubtitleTrack;

            console.log(
                `🎬 Applying offset: ${offset}s to track ${selectedTrack}`
            );

            if (selectedTrack >= 0) {
                // Disable button during processing
                applyBtn.disabled = true;
                applyBtn.textContent = "Applying...";

                try {
                    // Update offset for selected track
                    this.subtitleOffsets[selectedTrack] = offset;

                    // Save offset preference
                    localStorage.setItem(
                        `subtitleOffset_${movieId}_${selectedTrack}`,
                        offset.toString()
                    );

                    // Reload the current track with new offset
                    await this.addSelectedSubtitleTrack(selectedTrack);

                    console.log(`✅ Applied ${offset}s offset successfully`);
                    this.showStatus(`Applied ${offset}s offset to subtitles`);
                } catch (error) {
                    console.error("Failed to apply subtitle offset:", error);
                    this.showStatus("Failed to apply subtitle offset");
                } finally {
                    // Re-enable button
                    applyBtn.disabled = false;
                    applyBtn.textContent = "Apply";
                }
            } else {
                this.showStatus("Please select a subtitle track first");
            }
        };

        // Reset offset button
        resetBtn.onclick = async () => {
            const selectedTrack = this.selectedSubtitleTrack;

            if (selectedTrack >= 0) {
                // Disable button during processing
                resetBtn.disabled = true;
                resetBtn.textContent = "Resetting...";

                try {
                    // Reset offset
                    offsetInput.value = "0";
                    this.subtitleOffsets[selectedTrack] = 0;
                    localStorage.removeItem(
                        `subtitleOffset_${movieId}_${selectedTrack}`
                    );

                    // Reload track with no offset
                    await this.addSelectedSubtitleTrack(selectedTrack);

                    this.showStatus("Reset subtitle timing");
                } catch (error) {
                    console.error("Failed to reset subtitle offset:", error);
                    this.showStatus("Failed to reset subtitle timing");
                } finally {
                    // Re-enable button
                    resetBtn.disabled = false;
                    resetBtn.textContent = "Reset";
                }
            }
        };
    }

    updateSubtitleTrackSelector(subtitles) {
        const trackSelect = document.getElementById("subtitle-track-select");
        if (!trackSelect) return;

        // Clear existing options
        trackSelect.innerHTML = '<option value="-1">No Subtitles</option>';

        // Add subtitle options
        subtitles.forEach((subtitle, index) => {
            const option = document.createElement("option");
            option.value = index.toString();
            option.textContent = `${index + 1} ${subtitle.label} (${
                subtitle.language
            })`;
            trackSelect.appendChild(option);
        });
    }

    parseVTTTime(timeString) {
        // Handle both HH:MM:SS.mmm and MM:SS.mmm formats
        const parts = timeString.split(":");
        let hours = 0,
            minutes = 0,
            seconds = 0;

        if (parts.length === 3) {
            // HH:MM:SS.mmm format
            hours = parseInt(parts[0]);
            minutes = parseInt(parts[1]);
            const secParts = parts[2].split(".");
            seconds = parseInt(secParts[0]);
            const milliseconds = parseInt(secParts[1] || 0);
            return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
        } else if (parts.length === 2) {
            // MM:SS.mmm format
            minutes = parseInt(parts[0]);
            const secParts = parts[1].split(".");
            seconds = parseInt(secParts[0]);
            const milliseconds = parseInt(secParts[1] || 0);
            return minutes * 60 + seconds + milliseconds / 1000;
        }

        // Fallback - shouldn't happen
        return 0;
    }

    formatVTTTime(totalSeconds) {
        // Round to nearest millisecond to avoid floating-point precision issues
        const rounded = Math.round(totalSeconds * 1000) / 1000;

        const hours = Math.floor(rounded / 3600);
        const minutes = Math.floor((rounded % 3600) / 60);
        const seconds = Math.floor(rounded % 60);
        const milliseconds = Math.round((rounded % 1) * 1000);

        // Always include hours for consistency (VTT standard)
        return `${hours.toString().padStart(2, "0")}:${minutes
            .toString()
            .padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
    }

    // Improved subtitle offset methods that handle all VTT timestamp formats

    parseVTTTime(timeString) {
        // Handle both HH:MM:SS.mmm and MM:SS.mmm formats
        const parts = timeString.split(":");
        let hours = 0,
            minutes = 0,
            seconds = 0;

        if (parts.length === 3) {
            // HH:MM:SS.mmm format
            hours = parseInt(parts[0]);
            minutes = parseInt(parts[1]);
            const secParts = parts[2].split(".");
            seconds = parseInt(secParts[0]);
            const milliseconds = parseInt(secParts[1] || 0);
            return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
        } else if (parts.length === 2) {
            // MM:SS.mmm format
            minutes = parseInt(parts[0]);
            const secParts = parts[1].split(".");
            seconds = parseInt(secParts[0]);
            const milliseconds = parseInt(secParts[1] || 0);
            return minutes * 60 + seconds + milliseconds / 1000;
        }

        // Fallback - shouldn't happen
        return 0;
    }

    formatVTTTime(totalSeconds) {
        // Round to nearest millisecond to avoid floating-point precision issues
        const rounded = Math.round(totalSeconds * 1000) / 1000;

        const hours = Math.floor(rounded / 3600);
        const minutes = Math.floor((rounded % 3600) / 60);
        const seconds = Math.floor(rounded % 60);
        const milliseconds = Math.round((rounded % 1) * 1000);

        // Always include hours for consistency (VTT standard)
        return `${hours.toString().padStart(2, "0")}:${minutes
            .toString()
            .padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
    }

    offsetTimingLine(timingLine, offsetSeconds) {
        // More flexible regex that handles various VTT timestamp formats
        const timingRegex =
            /(\d{1,2}:)?(\d{1,2}):(\d{2})\.(\d{3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})\.(\d{3})/;
        const match = timingLine.match(timingRegex);

        if (!match) {
            console.warn("Could not parse timing line:", timingLine);
            return timingLine;
        }

        // Extract start time components
        const startHours = match[1] ? match[1].slice(0, -1) : "0"; // Remove ':' if present
        const startMinutes = match[2];
        const startSeconds = match[3];
        const startMilliseconds = match[4];

        // Extract end time components
        const endHours = match[5] ? match[5].slice(0, -1) : "0"; // Remove ':' if present
        const endMinutes = match[6];
        const endSecondsStr = match[7];
        const endMilliseconds = match[8];

        // Parse times
        const startTime =
            parseInt(startHours) * 3600 +
            parseInt(startMinutes) * 60 +
            parseInt(startSeconds) +
            parseInt(startMilliseconds) / 1000;

        const endTime =
            parseInt(endHours) * 3600 +
            parseInt(endMinutes) * 60 +
            parseInt(endSecondsStr) +
            parseInt(endMilliseconds) / 1000;

        // Apply offset and handle negative times properly
        let newStartTime = startTime + offsetSeconds;
        let newEndTime = endTime + offsetSeconds;

        // If start time goes negative, clip to 0 and adjust end time accordingly
        if (newStartTime < 0) {
            const adjustment = -newStartTime;
            newStartTime = 0;
            newEndTime = Math.max(0.1, newEndTime + adjustment);
        }

        // Ensure end time is always after start time
        newEndTime = Math.max(newStartTime + 0.1, newEndTime);

        const newStartFormatted = this.formatVTTTime(newStartTime);
        const newEndFormatted = this.formatVTTTime(newEndTime);

        return `${newStartFormatted} --> ${newEndFormatted}`;
    }

    applySubtitleOffset(vttContent, offsetSeconds) {
        if (offsetSeconds === 0) return vttContent;

        console.log(`Applying ${offsetSeconds}s offset to subtitle`);

        const lines = vttContent.split("\n");
        let processedCount = 0;

        const processedLines = lines.map((line, index) => {
            // Check if line contains timing information
            if (line.includes("-->")) {
                const originalLine = line;
                const processedLine = this.offsetTimingLine(
                    line,
                    offsetSeconds
                );

                if (processedLine !== originalLine) {
                    processedCount++;
                } else {
                    console.warn(
                        `Failed to process timing line ${index + 1}:`,
                        originalLine
                    );
                }

                return processedLine;
            }
            return line;
        });

        console.log(
            `Successfully processed ${processedCount} timing lines out of ${
                lines.filter((l) => l.includes("-->")).length
            } total`
        );

        return processedLines.join("\n");
    }

    isRetryableStreamError(errorData) {
        if (errorData.type === "mediaError") {
            if (errorData.details === "bufferStalledError") {
                return true;
            } else if (errorData.details === "bufferAppendError") {
                return false;
            }
        } else if (errorData.type === "networkError") {
            if (errorData.details === "levelEmptyError") {
                return true;
            } else if (errorData.details === "fragLoadError") {
                if (errorData.response.code === 403) {
                    return true;
                } else if (errorData.response.code === 404) {
                    return true;
                }
            }
        }
        return false;

        // return (
        //     // (errorData.fatal) ||
        //     (errorData.type === "mediaError" &&
        //         ) ||
        //     (errorData.type === "networkError" &&
        //         (errorData.details == "levelEmptyError" ||
        //             (errorData.details === "fragLoadError" &&
        //                 )))
        // );
    }

    async handleStreamError(errorData) {
        // Prevent multiple simultaneous requests
        if (this.retryState.isRetrying) {
            console.log("Already retrying, ignoring additional error");
            return;
        }

        this.retryState.isRetrying = true;

        // Store current playback position and pause the player
        const video = document.getElementById("video-player");
        this.recoveryPosition = Math.max(
            0,
            (video ? video.currentTime : 0) - 5
        );
        console.log("Storing recovery position:", this.recoveryPosition);

        // Pause the video during recovery
        if (video) {
            video.pause();
        }

        // Exit fullscreen if active
        if (document.fullscreenElement === video) {
            document
                .exitFullscreen()
                .catch((err) =>
                    console.warn("Failed to exit fullscreen:", err)
                );
        }

        try {
            const movieId = this.getMovieId(this.currentMovie);
            const ownerIdentityId = this.currentLibraryOwner;

            console.log(
                "Requesting movie re-processing due to stream error:",
                errorData.details
            );

            await this.makeAuthenticatedRequest(
                "POST",
                `/libraries/${ownerIdentityId}/movies/${movieId}/request`
            );

            this.showStatus("Stream error occurred. Re-processing movie...");
            this.showVideoLoading("Waiting for movie...");

            // Show status bar and start polling for recovery
            this.showMovieStatusBar();
            this.pollMovieStatus(this.currentMovie);
        } catch (requestError) {
            console.error("Failed to request re-processing:", requestError);
            this.retryState.isRetrying = false;
            this.showStatus(
                "Stream error occurred. Please try refreshing the page."
            );
        }
    }

    resetRetryState() {
        this.retryState = {
            attempts: 0,
            phase: "initial",
            isRetrying: false,
        };
    }

    showVideoLoading(text = "Loading video...") {
        const loadingOverlay = document.getElementById("loading-overlay");
        const loadingText = document.getElementById("loading-text");

        if (loadingText) loadingText.textContent = text;
        if (loadingOverlay) loadingOverlay.classList.remove("hidden");
    }

    hideVideoLoading() {
        const loadingOverlay = document.getElementById("loading-overlay");
        if (loadingOverlay) loadingOverlay.classList.add("hidden");
    }

    updateQualitySelector(levels) {
        // const qualitySelect = document.getElementById("quality-select");
        // const qualitySelector = document.getElementById("quality-selector");
        // if (!qualitySelect || !qualitySelector) return;
        // qualitySelect.innerHTML = '<option value="-1">Auto Quality</option>';
        // levels.forEach((level, index) => {
        //     const option = document.createElement("option");
        //     option.value = index;
        //     option.textContent = `${level.height}p (${Math.round(
        //         level.bitrate / 1000
        //     )}kbps)`;
        //     qualitySelect.appendChild(option);
        // });
        // qualitySelector.style.display = "block";
        // // Add quality change handler
        // qualitySelect.onchange = (e) => {
        //     if (this.hls) {
        //         this.hls.currentLevel = parseInt(e.target.value);
        //     }
        // };
    }

    getErrorMessage(error) {
        const errorMessage = error.message || error.toString();

        if (errorMessage.includes("NotAuthorizedException")) {
            return "Invalid username or password";
        } else if (errorMessage.includes("UserNotConfirmedException")) {
            return "Please verify your email address first";
        } else if (errorMessage.includes("UsernameExistsException")) {
            return "Username already exists";
        } else if (errorMessage.includes("InvalidPasswordException")) {
            return "Password does not meet requirements";
        } else if (errorMessage.includes("CodeMismatchException")) {
            return "Invalid verification code";
        } else if (errorMessage.includes("ExpiredCodeException")) {
            return "Verification code has expired";
        } else if (errorMessage.includes("TooManyRequestsException")) {
            return "Too many requests. Please try again later";
        } else if (errorMessage.includes("LimitExceededException")) {
            return "Attempt limit exceeded. Please try again later";
        } else if (errorMessage.includes("InvalidParameterException")) {
            return "Invalid input parameters";
        } else {
            return errorMessage;
        }
    }

    clearLibraryPageContent() {
        document.getElementById("library-content").innerHTML =
            "<p>Loading library contents...</p>";
        document.getElementById("shared-users-list").innerHTML =
            "<p>Loading shared users...</p>";
    }

    clearLibrariesPageContent() {
        document.getElementById("libraries-list").innerHTML =
            "<p>Loading libraries...</p>";
    }

    clearMoviePageContent() {
        this.stopPositionTracking();
        this.stopStatusPolling(); // Already added

        // Reset movie details
        document.getElementById("movie-description").textContent = "Loading...";
        document.getElementById("movie-title").textContent = "Movie Title";
        document.getElementById("movie-year").textContent = "Unknown";
        document.getElementById("movie-runtime").textContent = "Unknown";
        document.getElementById("movie-quality").textContent = "Unknown";
        document.getElementById("poster-container").innerHTML = "";

        // Hide and reset status bar
        this.hideMovieStatusBar(); // Already added
        this.resetMovieStatusBar(); // Add this new method call

        // Clear video player
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        const video = document.getElementById("video-player");
        if (video) {
            video.src = "";
            video.load();
        }

        this.hideVideoLoading();
        this.hidePlayButton();

        const qualitySelector = document.getElementById("quality-selector");
        if (qualitySelector) qualitySelector.style.display = "none";

        // Reset retry state
        this.resetRetryState();
        this.playlistUrl = null;

        // Hide subtitle controls
        const subtitleControls = document.getElementById("subtitle-controls");
        if (subtitleControls) {
            subtitleControls.style.display = "none";
        }

        // Clear subtitle data
        this.currentSubtitles = [];
        this.subtitleOffsets = {};
        this.cleanupSubtitleUrls();
    }

    // Clean up blob URLs when destroying the player
    cleanupSubtitleUrls() {
        const video = document.getElementById("video-player");
        if (video) {
            const tracks = video.querySelectorAll('track[kind="subtitles"]');
            tracks.forEach((track) => {
                if (track.src.startsWith("blob:")) {
                    URL.revokeObjectURL(track.src);
                }
            });
        }
    }

    clearAccountContent() {
        // Clear account sections
        const accountElements = document.querySelectorAll(
            ".account-section-content"
        );
        accountElements.forEach((element) => {
            element.innerHTML = "";
        });
    }

    clearContentSections() {
        // Clear content sections
        clearLibrariesPageContent();
        clearLibraryPageContent();
        clearMoviePageContent();
        clearAccountContent();
        this.resetMovieStatusBar();
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    createPlaylistBlobUrl(playlistText) {
        const blob = new Blob([playlistText], {
            type: "application/vnd.apple.mpegurl",
        });
        return URL.createObjectURL(blob);
    }

    updateUrl(page, params = {}) {
        const url = new URL(window.location);
        url.searchParams.set("p", page);

        // Clear existing params and set new ones
        ["l", "m"].forEach((param) => url.searchParams.delete(param));

        if (params.libraryOwner) {
            // Encode libraryOwner (identity ID) as base64
            const encodedLibraryOwner = utf8ToBase64(params.libraryOwner);
            url.searchParams.set("l", encodedLibraryOwner);
        }
        if (params.movieId) {
            url.searchParams.set("m", params.movieId);
        }

        window.history.pushState(null, "", url.toString());
    }

    parseUrl() {
        const params = new URLSearchParams(window.location.search);

        let libraryOwner = params.get("l");
        // Decode libraryOwner from base64 if it exists
        if (libraryOwner) {
            try {
                libraryOwner = base64ToUtf8(libraryOwner);
            } catch (error) {
                console.warn(
                    "Failed to decode libraryOwner from base64:",
                    error
                );
                // Fall back to using the raw value if decoding fails
            }
        }

        return {
            page: params.get("p"),
            libraryOwner: libraryOwner,
            movieId: params.get("m"),
        };
    }

    async navigateToPage(urlParams) {
        const { page, libraryOwner, movieId } = urlParams;

        if (!this.currentUser) {
            this.showSigninView();
            return;
        }

        switch (page) {
            case "signin":
                this.showSigninView();
                break;
            case "signup":
                this.showSignupView();
                break;
            case "verify":
                this.showVerificationView();
                break;
            case "library":
                if (libraryOwner) {
                    this.showLibraryView(libraryOwner);
                } else {
                    this.showLibrariesView();
                    this.updateUrl("libraries");
                }
                break;
            case "movie":
                if (libraryOwner && movieId) {
                    await this.navigateToMovie(libraryOwner, movieId);
                } else {
                    this.showLibrariesView();
                    this.updateUrl("libraries");
                }
                break;
            case "libraries":
            default:
                this.showLibrariesView();
                this.updateUrl("libraries");
                break;
        }
    }

    findMovieById(movieId) {
        if (!this.currentLibraryData) return null;

        for (const collection of Object.keys(this.currentLibraryData)) {
            const movie = this.currentLibraryData[collection].find(
                (m) => this.getMovieId({ ...m, collection }) === movieId
            );
            if (movie) {
                return { ...movie, collection };
            }
        }
        return null;
    }

    async navigateToMovie(libraryOwner, movieId) {
        try {
            // Set the current library owner
            this.currentLibraryOwner = libraryOwner;

            // Check if we need to load library data
            if (
                !this.currentLibraryData ||
                this.currentLibraryOwner !== libraryOwner
            ) {
                console.log("Loading library data for movie navigation...");
                this.showLoadingView();

                // Load the library data
                const result = await this.makeAuthenticatedRequest(
                    "GET",
                    `/libraries/${libraryOwner}/library`
                );
                this.currentLibraryData = result;
            }

            // Now try to find the movie
            const movie = this.findMovieById(movieId);
            if (movie) {
                this.showMovieView(movie);
            } else {
                console.warn("Movie not found with ID:", movieId);
                this.showLibraryView(libraryOwner);
                this.showStatus("Movie not found, showing library instead");
            }
        } catch (error) {
            console.error("Error navigating to movie:", error);
            if (error.statusCode === 403) {
                this.showStatus("Access denied to this library");
                this.showLibrariesView();
                this.updateUrl("libraries");
            } else if (error.statusCode === 404) {
                this.showStatus("Library not found");
                this.showLibrariesView();
                this.updateUrl("libraries");
            } else if (error.statusCode === 401) {
                this.showStatus("Session expired. Please sign in again.");
                this.handleLogout();
            } else {
                this.showStatus(
                    "Error loading movie: " + (error.message || "Unknown error")
                );
                this.showLibrariesView();
                this.updateUrl("libraries");
            }
        }
    }

    updateMovieStatusBar(statusData) {
        const messageEl = document.getElementById("status-message-text");
        const percentageEl = document.getElementById("status-percentage");
        const progressFillEl = document.getElementById("status-progress-fill");
        const etaEl = document.getElementById("status-eta");
        const stageEl = document.getElementById("status-stage");
        const statusBar = document.getElementById("movie-status-bar");

        if (!messageEl || !percentageEl || !progressFillEl) return;

        // Update message - use custom message if provided, otherwise use default
        let displayMessage = statusData.message;
        if (!displayMessage) {
            if (
                statusData.stageName === "uploading" &&
                statusData.percentage >= 40
            ) {
                displayMessage =
                    statusData.percentage === 40
                        ? "Stream preview ready"
                        : "Streaming rest of movie";
            } else {
                displayMessage = this.getStatusMessage(statusData.stageName);
            }
        }
        messageEl.textContent = displayMessage;

        // Update percentage
        percentageEl.textContent = `${Math.round(statusData.percentage)}%`;

        // Update progress bar
        progressFillEl.style.width = `${statusData.percentage}%`;

        // Update ETA if available
        if (statusData.eta) {
            const eta = new Date(statusData.eta);
            const now = new Date();
            const diffMinutes = Math.round(
                (eta.getTime() - now.getTime()) / 60000
            );
            etaEl.textContent = diffMinutes > 0 ? `ETA: ${diffMinutes}m` : "";
        } else {
            etaEl.textContent = "";
        }

        // Update stage
        stageEl.textContent = this.getStageDisplayName(statusData.stageName);

        // Add processing animation for active stages
        if (
            statusData.stageName === "reencoding" ||
            statusData.stageName === "converting_hls" ||
            statusData.stageName === "uploading"
        ) {
            statusBar.classList.add("processing");
        } else {
            statusBar.classList.remove("processing");
        }
    }

    async refreshLibraryIndex() {
        const button = document.getElementById("refresh-index-btn");
        const originalText = button.textContent;
        button.textContent = "Refreshing...";
        button.disabled = true;

        try {
            await this.makeAuthenticatedRequest(
                "POST",
                `/libraries/${this.currentUser.identityId}/refresh`
            );

            this.showStatus(
                "Library refresh started. Reloading in 5 seconds..."
            );

            // Wait 5 seconds then reload library
            setTimeout(async () => {
                await this.loadLibraryData();
                this.showStatus("Library refreshed successfully!");
            }, 5000);
        } catch (error) {
            console.error("Error refreshing library index:", error);

            if (error.statusCode === 403) {
                this.showStatus("You can only refresh your own library");
            } else if (error.statusCode === 404) {
                this.showStatus("Library not found");
            } else if (error.statusCode === 401) {
                this.showStatus("Session expired. Please sign in again.");
                this.handleLogout();
            } else {
                this.showStatus(
                    "Error refreshing library: " +
                        (error.message || "Unknown error")
                );
            }
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async refreshLibraryContent() {
        const button = document.getElementById("refresh-library-btn");
        const originalText = button.textContent;
        button.textContent = "Refreshing...";
        button.disabled = true;

        try {
            await this.loadLibraryData();
            this.showStatus("Library content refreshed!");
        } catch (error) {
            console.error("Error refreshing library content:", error);
            this.showStatus("Error refreshing library content");
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    getStatusMessage(stageName) {
        const messages = {
            starting: "Processing movie",
            reencoding: "Encoding movie",
            converting_hls: "Converting to stream",
            uploading: "Streaming movie",
            completed: "Ready to watch",
            failed: "Processing failed",
        };
        return messages[stageName] || "Processing";
    }

    getStageDisplayName(stageName) {
        const stages = {
            starting: "Processing",
            reencoding: "Encoding",
            converting_hls: "Converting",
            uploading: "Streaming",
            completed: "Ready",
            failed: "Error",
        };
        return stages[stageName] || stageName;
    }

    async pollMovieStatus(movie) {
        if (this.isPollingStatus) {
            console.log("Status polling already active");
            return;
        }

        this.isPollingStatus = true;
        const movieId = this.getMovieId(movie);
        const ownerIdentityId = this.currentLibraryOwner;

        console.log(`Starting status polling for movie: ${movieId}`);

        this.statusPollingInterval = setInterval(async () => {
            try {
                const statusResponse = await this.makeAuthenticatedRequest(
                    "GET",
                    `/libraries/${ownerIdentityId}/movies/${movieId}/status`
                );

                this.lastStatusResponse = statusResponse;
                console.log("Status update:", statusResponse);
                this.updateMovieStatusBar(statusResponse);

                // Check if streaming is ready (40% progress)
                if (
                    statusResponse.stageName === "uploading" ||
                    (statusResponse.stageName === "completed" &&
                        statusResponse.percentage >= 40)
                ) {
                    if (this.isStreamError) {
                        // Handle stream recovery
                        console.log(
                            "Stream ready for recovery, reloading player..."
                        );
                        await this.recoverStream(movie);
                    } else if (!this.playlistUrl) {
                        // Handle initial load
                        console.log(
                            "Stream ready for initial load, starting player..."
                        );
                        // this.savePlaybackPosition(movieId, 0);
                        await this.initializeVideoPlayer(movie);
                    }
                }

                // Stop polling when completed or failed
                if (
                    statusResponse.stageName === "completed" ||
                    statusResponse.stageName === "failed"
                ) {
                    this.stopStatusPolling();

                    if (statusResponse.stageName === "completed") {
                        // Hide status bar after delay
                        setTimeout(() => this.hideMovieStatusBar(), 10000);
                    }
                }
            } catch (error) {
                console.warn("Failed to get movie status:", error);

                if (error.statusCode === 403 || error.statusCode === 401) {
                    this.stopStatusPolling();
                }
                // Continue polling for other errors (404, 500, etc.)
            }
        }, 8000);
    }

    async recoverStream(movie) {
        try {
            console.log("Recovering stream...");
            const playlistUrl = await this.getMovieStreamUrl(movie);

            if (playlistUrl) {
                this.playlistUrl = playlistUrl;
                const subtitles = await this.loadMovieSubtitles(movie);
                this.setupHLSPlayer(this.playlistUrl, true, subtitles);

                // Hide the loading overlay after successful recovery
                this.hideVideoLoading();

                // Ensure video resumes playing after a brief delay
                setTimeout(() => {
                    const video = document.getElementById("video-player");
                    if (video && video.paused) {
                        video.play().catch((error) => {
                            console.warn(
                                "Failed to resume playback after recovery:",
                                error
                            );
                        });
                    }
                }, 500);

                this.isStreamError = false;
                this.retryState.isRetrying = false;
                this.showStatus("Video stream recovered successfully!");
            }
        } catch (error) {
            console.error("Stream recovery failed:", error);
            this.showStatus(
                "Stream recovery failed. Please try playing again."
            );
            this.hideVideoLoading();
            this.showPlayButton();
        }
    }

    stopStatusPolling() {
        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
            this.statusPollingInterval = null;
        }
        this.isPollingStatus = false;
        console.log("Stopped status polling");
    }

    cleanMovieTitleForSearch(title) {
        if (!title) return title;

        let cleanedTitle = title;

        // Replace em dashes (–) with regular hyphens (-)
        cleanedTitle = cleanedTitle.replace(/–/g, "-");

        // Remove problematic strings that interfere with search
        const problematicStrings = [
            /\s*[-–]\s*Theatrical\s+Cut\s*/gi,
            /\s*[-–]\s*Theater\s+Cut\s*/gi,
            /\s*[-–]\s*Extended\s+Cut\s*/gi,
            /\s*[-–]\s*Ultimate\s+Cut\s*/gi,
            /\s*[-–]\s*Final\s+Cut\s*/gi,
            /\s*[-–]\s*Unrated\s+Cut\s*/gi,
            /\s*[-–]\s*Uncut\s*/gi,
            /\s*[-–]\s*Remastered\s*/gi,
            /\s*[-–]\s*Special\s+Edition\s*/gi,
            /\s*[-–]\s*Anniversary\s+Edition\s*/gi,
            /\s*[-–]\s*Collector's\s+Edition\s*/gi,
            /\s*[-–]\s*Limited\s+Edition\s*/gi,
            /\s*[-–]\s*Criterion\s+Collection\s*/gi,
            /\s*\(.*?Cut\)\s*/gi, // Remove parenthetical cuts like "(Director's Cut)"
            /\s*\(.*?Edition\)\s*/gi, // Remove parenthetical editions
            /\s*\(Remastered\)\s*/gi,
            /\s*\(Unrated\)\s*/gi,
            /\s*\(Uncut\)\s*/gi,
        ];

        // Apply all cleanup rules
        problematicStrings.forEach((pattern) => {
            cleanedTitle = cleanedTitle.replace(pattern, "");
        });

        // Clean up extra whitespace and trim
        cleanedTitle = cleanedTitle.replace(/\s+/g, " ").trim();

        // Remove trailing punctuation that might interfere
        cleanedTitle = cleanedTitle.replace(/[,;:.!?]+$/, "");

        console.log(`Title cleanup: "${title}" → "${cleanedTitle}"`);

        return cleanedTitle;
    }
}

function onDOMReady(callback) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
        callback();
    }
}

// Initialize the app when the page loads
onDOMReady((_) => {
    window.mediaLibraryApp = new MediaLibraryApp();
});
