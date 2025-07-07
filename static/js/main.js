import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import Hls from "hls.js";

import { CONFIG } from "./config/config.js";

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
        this.initializeEventListeners();
        this.showLoadingView();
        this.checkExistingSession();
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
    }

    showSignupView() {
        this.hideAllViews();
        document.getElementById("signup-view").style.display = "block";
    }

    showVerificationView() {
        this.hideAllViews();
        document.getElementById("verification-view").style.display = "block";
    }

    showLibrariesView(checkLibraryAccess = false) {
        this.hideAllViews();
        document.getElementById("libraries-view").style.display = "block";
        this.updateAccountSection();
        this.loadLibraries(checkLibraryAccess);
    }

    showLibraryView(ownerIdentityId) {
        this.hideAllViews();
        this.currentLibraryOwner = ownerIdentityId;
        document.getElementById("library-view").style.display = "block";
        this.updateAccountSection();
        this.loadLibraryData();

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
                <p>Username: ${this.currentUser.username}</p>
                <p>Email: ${this.currentUser.email}</p>
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
                const payload = JSON.parse(atob(idToken.split(".")[1]));
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

        this.showSigninView();
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
        const payload = JSON.parse(atob(idToken.split(".")[1]));
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

        this.showLibrariesView(true);
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
                this.showLibrariesView(); // Go back to libraries view
            } else if (error.statusCode === 404) {
                // this.showStatus("Library not found");
                // this.showLibrariesView();
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
            this.currentLibraryData[collection].forEach((movie) => {
                allMovies.push({
                    ...movie,
                    collection,
                });
            });
        });

        // Sort movies alphabetically by name
        allMovies.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        container.innerHTML = `
        <h3>Movies (${allMovies.length})</h3>
        ${allMovies
            .map(
                (movie, index) => `
                <div>
                    <h4>${movie.name || "Unknown Title"}</h4>
                    <p>Year: ${movie.year || "Unknown"}</p>
                    <p>Runtime: ${movie.runtime || "Unknown"}</p>
                    <p>Quality: ${movie.quality || "Unknown"}</p>
                    <button onclick="window.mediaLibraryApp.showMovieView(${JSON.stringify(
                        movie
                    ).replace(/"/g, "&quot;")})">
                        Play Movie
                    </button>
                    <div class="section-spacer"></div>
                    <hr>
                </div>
            `
            )
            .join("")}
    `;
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
    isValidUsername(username) {
        // Assuming usernames are 3-50 characters, alphanumeric plus underscores
        const usernameRegex = /^[a-zA-Z0-9_]{3,50}$/;
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
                queryParams.append("query", movie.name);
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
        this.showVideoLoading("Loading movie...");

        try {
            this.playlistUrl = await this.getMovieStreamUrlWithRetry(movie);
            // const playlistBlobUrl = this.createPlaylistBlobUrl(playlistText);
            await this.setupHLSPlayer(this.playlistUrl, false);
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
        return btoa(this.getMoviePathInLibrary(movie));
    }

    async getMovieStreamUrlWithRetry(movie) {
        this.resetRetryState();
        const movieId = this.getMovieId(movie);
        const ownerIdentityId = this.currentLibraryOwner;

        while (this.retryState.phase !== "failed") {
            try {
                const result = await this.getMovieStreamUrl(movie);

                // Reset retry state after successful stream URL retrieval
                this.resetRetryState();

                return result;
            } catch (error) {
                console.log(
                    `Attempt ${this.retryState.attempts + 1} failed:`,
                    error.message
                );

                // Request processing if this is the first failure
                if (
                    this.retryState.attempts === 0 &&
                    !this.retryState.isRetrying
                ) {
                    this.retryState.isRetrying = true;
                    this.showVideoLoading("Processing movie...");

                    try {
                        await this.makeAuthenticatedRequest(
                            "POST",
                            `/libraries/${ownerIdentityId}/movies/${movieId}/request`
                        );
                        console.log("Processing request sent");
                    } catch (requestError) {
                        console.warn(
                            "Failed to send processing request:",
                            requestError
                        );
                    }

                    this.showStatus(
                        "Processing movie, please wait up to 2 minutes"
                    );

                    // Wait 5 seconds after request
                    await this.delay(5000);
                }

                this.retryState.attempts++;

                // Determine next action based on current state
                if (
                    this.retryState.phase === "initial" &&
                    this.retryState.attempts >= 5
                ) {
                    this.retryState.phase = "first_retry_cycle";
                    this.retryState.attempts = 0;
                    this.showVideoLoading("Still preparing... please wait");
                    await this.delay(30000); // Wait 0.5 minute
                } else if (
                    this.retryState.phase === "first_retry_cycle" &&
                    this.retryState.attempts >= 5
                ) {
                    this.retryState.phase = "failed";
                    throw new Error(
                        "Video processing timed out. Please try again later."
                    );
                } else {
                    // Wait 10 seconds between retries
                    const waitTime =
                        this.retryState.phase === "initial" ? 10000 : 10000;
                    await this.delay(waitTime);
                }
            }
        }

        throw new Error("Maximum retry attempts exceeded");
    }

    async setupHLSPlayer(streamUrl, isRecovery = false) {
        // Destroy existing player if any
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

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
                // VOD-specific settings:
                lowLatencyMode: false,
                startPosition: isRecovery ? this.recoveryPosition : 0,
            });

            this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                this.hideVideoLoading();
                this.updateQualitySelector(data.levels);

                // Reset retry state after successful manifest parsing
                this.resetRetryState();

                if (isRecovery) {
                    // Wait a moment for HLS to initialize, then for recovery, restore position and continue playing
                    setTimeout(() => {
                        video.currentTime = this.recoveryPosition;
                        video.play().catch((error) => {
                            console.warn("Recovery autoplay failed:", error);
                        });
                    }, 100);
                } else {
                    // Wait a moment for HLS to initialize, then force start position and play from beginning
                    setTimeout(() => {
                        video.currentTime = 0;
                        video.play().catch((error) => {
                            console.warn("Autoplay failed:", error);
                        });
                    }, 100);
                }
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                console.error("HLS error:", data);
                if (
                    data.fatal ||
                    (data.type === "mediaError" &&
                        data.details === "bufferStalledError")
                ) {
                    // this.hideVideoLoading();
                    // this.showPlayButton();
                    // this.showStatus(
                    //     "Error playing video stream, re-requesting movie"
                    // );
                    this.handleStreamError(data);
                }
            });

            this.hls.loadSource(streamUrl);
            this.hls.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = streamUrl;

            if (!isRecovery) {
                video.addEventListener(
                    "loadedmetadata",
                    () => {
                        video.currentTime = 0;
                        this.hideVideoLoading();
                    },
                    { once: true }
                );
            } else {
                this.hideVideoLoading();
            }

            // For native HLS support (Safari), start playing automatically
            video.play().catch((error) => {
                console.warn("Autoplay failed:", error);
            });
        } else {
            throw new Error("Video streaming not supported in this browser");
        }
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
        this.recoveryPosition = (video ? video.currentTime : 0) - 5;
        this.recoveryPosition =
            this.recoveryPosition < 0 ? 0 : this.recoveryPosition;
        console.log("Storing recovery position:", this.recoveryPosition);

        // Pause the video during recovery
        if (video) {
            video.pause();
        }

        // Exit fullscreen if active
        if (document.fullscreenElement === video) {
            document.exitFullscreen().catch((err) => {
                console.warn("Failed to exit fullscreen:", err);
            });
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

            // Start polling for the new playlist
            this.startStreamRecoveryPolling();
        } catch (requestError) {
            console.error("Failed to request re-processing:", requestError);
            this.retryState.isRetrying = false;
            this.showStatus(
                "Stream error occurred. Please try refreshing the page."
            );
        }
    }

    async startStreamRecoveryPolling() {
        console.log("Starting stream recovery polling...");
        this.showVideoLoading("Re-processing movie...");

        const maxAttempts = 20;
        let attempts = 0;
        let pollInterval = null;
        setTimeout(async () => {
            pollInterval = setInterval(async () => {
                attempts++;
                console.log(
                    `Recovery polling attempt ${attempts}/${maxAttempts}`
                );

                try {
                    // Reload the HLS player with the same playlist URL
                    await this.setupHLSPlayer(this.playlistUrl, true);

                    // Check if the HLS player successfully loaded
                    if (this.hls && this.hls.media) {
                        console.log(
                            "Stream recovery successful, player reloaded"
                        );
                        clearInterval(pollInterval);
                        this.retryState.isRetrying = false;
                        this.showStatus("Video stream recovered successfully!");
                        return;
                    }

                    // If we get here without the media attached, it might still be loading
                    // Let it continue to the next attempt
                } catch (error) {
                    console.log(
                        `Recovery attempt ${attempts} failed:`,
                        error.message
                    );
                }

                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    this.retryState.isRetrying = false;
                    this.hideVideoLoading();
                    this.showPlayButton();
                    this.showStatus(
                        "Stream recovery failed. Please try playing again."
                    );
                }
            }, CONFIG.streamRecoveryRetryInterval);
        }, CONFIG.streamRecoveryRetryInterval);
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
        // Reset movie details
        document.getElementById("movie-description").textContent = "Loading...";
        document.getElementById("movie-title").textContent = "Movie Title";
        document.getElementById("movie-year").textContent = "Unknown";
        document.getElementById("movie-runtime").textContent = "Unknown";
        document.getElementById("movie-quality").textContent = "Unknown";
        document.getElementById("poster-container").innerHTML = "";

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
