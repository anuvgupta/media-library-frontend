import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { CONFIG } from "./config/config.js";

class MediaLibraryApp {
    constructor() {
        this.currentUser = null;
        this.cognitoIdentityClient = null;
        this.credentials = null;
        this.currentLibraryOwner = null;
        this.currentLibraryData = null;
        this.libraries = [];
        this.initializeEventListeners();
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

        // Navigation buttons
        document
            .getElementById("back-to-libraries-btn")
            .addEventListener("click", () => this.showLibrariesView());

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
        setTimeout(() => {
            // statusElement.style.display = "none";
            statusElement.style.opacity = 0;
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

    showLibrariesView() {
        this.hideAllViews();
        document.getElementById("libraries-view").style.display = "block";
        this.updateAccountSection();
        this.loadLibraries();
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

    hideAllViews() {
        const views = [
            "signin-view",
            "signup-view",
            "verification-view",
            "libraries-view",
            "library-view",
        ];
        views.forEach((view) => {
            document.getElementById(view).style.display = "none";
        });
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

    async handleLogin() {
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;

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
        const code = document.getElementById("verification-code").value.trim();

        if (!username) {
            this.showStatus("Please enter your current username");
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
            this.showStatus(
                "Email verified successfully! You can now sign in."
            );
            this.showSigninView();
        } catch (error) {
            console.error("Verification error:", error);
            this.showStatus(this.getErrorMessage(error));
        } finally {
            verifyBtn.textContent = originalText;
            verifyBtn.disabled = false;
        }
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
        const identityId = await this.getIdentityId();
        this.currentUser.identityId = identityId;

        this.showLibrariesView();
        this.showStatus("Successfully signed in!");
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
            await this.credentials();
            console.log("AWS credentials initialized successfully");
        } catch (error) {
            console.error("Error initializing AWS credentials:", error);
            throw error;
        }
    }

    async getIdentityId() {
        try {
            const credentialsProvider = await this.credentials();
            return credentialsProvider.identityId;
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
    }

    async makeAuthenticatedRequest(method, path, body = null) {
        if (!this.credentials) {
            throw new Error("Not authenticated - no AWS credentials available");
        }

        try {
            // Get fresh credentials
            const awsCredentials = await this.credentials();

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
                throw new Error(`HTTP ${response.status}: ${errorText}`);
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

    async loadLibraries() {
        try {
            const result = await this.makeAuthenticatedRequest(
                "GET",
                "/libraries"
            );
            this.libraries = result.ownedLibrary ? [result.ownedLibrary] : [];
            this.libraries = [...this.libraries, ...result.sharedLibraries];
            this.displayLibraries();
        } catch (error) {
            console.error("Error loading libraries:", error);
            this.showStatus("Error loading libraries: " + error.message);
        }
    }

    displayLibraries() {
        const container = document.getElementById("libraries-list");

        if (this.libraries.length === 0) {
            container.innerHTML = "<p>No libraries found.</p>";
            return;
        }

        container.innerHTML = this.libraries
            .map(
                (library) => `
            <div>
                <h4>Library Owner: ${library.ownerIdentityId}</h4>
                <button onclick="window.mediaLibraryApp.showLibraryView('${library.ownerIdentityId}')">
                    View Library
                </button>
                <hr>
            </div>
        `
            )
            .join("");
        // <p>Movies: ${library.movieCount || 0}</p>
        // <p>Collections: ${library.collectionCount || 0}</p>
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
            this.showStatus("Error loading library data: " + error.message);
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
        Object.keys(this.currentLibraryData).forEach((groupName) => {
            this.currentLibraryData[groupName].forEach((movie) => {
                allMovies.push(movie);
            });
        });

        // Sort movies alphabetically by name
        allMovies.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        container.innerHTML = `
        <h3>Movies (${allMovies.length})</h3>
        ${allMovies
            .map(
                (movie) => `
                <div>
                    <h4>${movie.name || "Unknown Title"}</h4>
                    <p>Year: ${movie.year || "Unknown"}</p>
                    <p>Runtime: ${movie.runtime || "Unknown"}</p>
                    <p>Quality: ${movie.quality || "Unknown"}</p>
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

        const button = document.getElementById("share-library-btn");
        const originalText = button.textContent;
        button.textContent = "Sharing...";
        button.disabled = true;

        try {
            await this.makeAuthenticatedRequest(
                "POST",
                `/libraries/${this.currentUser.identityId}/share`,
                {
                    shareWithIdentityId: shareWithInput,
                }
            );

            this.showStatus("Library shared successfully!");
            document.getElementById("share-with-input").value = "";
            this.loadSharedUsers(); // Refresh the shared users list
        } catch (error) {
            console.error("Error sharing library:", error);
            this.showStatus("Error sharing library: " + error.message);
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
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
            this.showStatus("Error loading shared users: " + error.message);
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
            <div>
                <p>Username: ${user.username || "Unknown"}</p>
                <p>Email: ${user.email || "N/A"}</p>
                <p>User ID: ${user.sharedWithIdentityId}</p>
                <p>Shared: ${new Date(user.sharedAt).toLocaleDateString()}</p>
                <hr>
            </div>
        `
            )
            .join("");
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
}

// Initialize the app when the page loads
document.addEventListener("DOMContentLoaded", () => {
    window.mediaLibraryApp = new MediaLibraryApp();
});
