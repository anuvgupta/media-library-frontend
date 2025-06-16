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
        this.initializeEventListeners();
        this.checkExistingSession();
    }

    initializeEventListeners() {
        // Auth buttons
        document
            .getElementById("login-btn")
            .addEventListener("click", () => this.handleLogin());
        document
            .getElementById("register-btn")
            .addEventListener("click", () => this.showRegisterForm());
        document
            .getElementById("signup-btn")
            .addEventListener("click", () => this.handleSignup());
        document
            .getElementById("back-to-login-btn")
            .addEventListener("click", () => this.showLoginForm());
        document
            .getElementById("verify-btn")
            .addEventListener("click", () => this.handleVerification());
        document
            .getElementById("resend-code-btn")
            .addEventListener("click", () => this.resendVerificationCode());
        document
            .getElementById("logout-btn")
            .addEventListener("click", () => this.handleLogout());

        // API buttons
        document
            .getElementById("get-libraries-btn")
            .addEventListener("click", () => this.getLibraries());
        document
            .getElementById("get-library-json-btn")
            .addEventListener("click", () => this.getLibraryJson());
        document
            .getElementById("get-playlist-btn")
            .addEventListener("click", () => this.getPlaylist());

        // Enter key handlers
        document
            .getElementById("password")
            .addEventListener("keypress", (e) => {
                if (e.key === "Enter") this.handleLogin();
            });
        document
            .getElementById("reg-password")
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
        statusElement.className = `status ${type}`;
        statusElement.textContent = message;
        statusElement.classList.remove("hidden");

        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusElement.classList.add("hidden");
        }, 5000);
    }

    showLoginForm() {
        document.getElementById("login-form").classList.remove("hidden");
        document.getElementById("register-form").classList.add("hidden");
        document.getElementById("verification-form").classList.add("hidden");
    }

    showRegisterForm() {
        document.getElementById("login-form").classList.add("hidden");
        document.getElementById("register-form").classList.remove("hidden");
        document.getElementById("verification-form").classList.add("hidden");
    }

    showVerificationForm() {
        document.getElementById("login-form").classList.add("hidden");
        document.getElementById("register-form").classList.add("hidden");
        document.getElementById("verification-form").classList.remove("hidden");
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

        this.showAuthSection();
    }

    async handleLogin() {
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;

        if (!username || !password) {
            this.showStatus("Please enter both username and password", "error");
            return;
        }

        const loginBtn = document.getElementById("login-btn");
        const originalText = loginBtn.textContent;
        loginBtn.innerHTML = '<span class="loading"></span>Signing In...';
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
            this.showStatus(this.getErrorMessage(error), "error");
        } finally {
            loginBtn.textContent = originalText;
            loginBtn.disabled = false;
        }
    }

    async handleSignup() {
        const username = document.getElementById("reg-username").value.trim();
        const email = document.getElementById("reg-email").value.trim();
        const password = document.getElementById("reg-password").value;

        if (!username || !email || !password) {
            this.showStatus("Please fill in all fields", "error");
            return;
        }

        const signupBtn = document.getElementById("signup-btn");
        const originalText = signupBtn.textContent;
        signupBtn.innerHTML =
            '<span class="loading"></span>Creating Account...';
        signupBtn.disabled = true;

        try {
            await this.signUpUser(username, email, password);
            this.pendingUsername = username;
            this.showVerificationForm();
            this.showStatus(
                "Account created! Please check your email for verification code.",
                "success"
            );
        } catch (error) {
            console.error("Signup error:", error);
            this.showStatus(this.getErrorMessage(error), "error");
        } finally {
            signupBtn.textContent = originalText;
            signupBtn.disabled = false;
        }
    }

    async handleVerification() {
        const code = document.getElementById("verification-code").value.trim();

        if (!code) {
            this.showStatus("Please enter the verification code", "error");
            return;
        }

        const verifyBtn = document.getElementById("verify-btn");
        const originalText = verifyBtn.textContent;
        verifyBtn.innerHTML = '<span class="loading"></span>Verifying...';
        verifyBtn.disabled = true;

        try {
            await this.confirmSignUp(this.pendingUsername, code);
            this.showStatus(
                "Email verified successfully! You can now sign in.",
                "success"
            );
            this.showLoginForm();
        } catch (error) {
            console.error("Verification error:", error);
            this.showStatus(this.getErrorMessage(error), "error");
        } finally {
            verifyBtn.textContent = originalText;
            verifyBtn.disabled = false;
        }
    }

    async resendVerificationCode() {
        if (!this.pendingUsername) {
            this.showStatus("No pending verification found", "error");
            return;
        }

        try {
            await this.resendConfirmationCode(this.pendingUsername);
            this.showStatus(
                "Verification code resent to your email",
                "success"
            );
        } catch (error) {
            console.error("Resend error:", error);
            this.showStatus(this.getErrorMessage(error), "error");
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

        this.showAppSection();
        this.updateUserInfo();
        this.showStatus("Successfully signed in!", "success");
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

    handleLogout() {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("idToken");
        localStorage.removeItem("refreshToken");
        this.currentUser = null;
        this.credentials = null;
        this.showAuthSection();
        this.showStatus("Successfully signed out", "info");
    }

    showAuthSection() {
        document.getElementById("auth-section").classList.remove("hidden");
        document.getElementById("app-section").classList.add("hidden");
        this.showLoginForm();
    }

    showAppSection() {
        document.getElementById("auth-section").classList.add("hidden");
        document.getElementById("app-section").classList.remove("hidden");
    }

    updateUserInfo() {
        const userDetails = document.getElementById("user-details");
        userDetails.innerHTML = `
            <strong>Username:</strong> ${this.currentUser.username}<br>
            <strong>Email:</strong> ${this.currentUser.email}<br>
            <strong>User ID:</strong> ${this.currentUser.sub}
        `;
    }

    async makeAuthenticatedRequest(method, path, body = null) {
        if (!this.currentUser?.idToken) {
            throw new Error("Not authenticated - no ID token");
        }

        try {
            const url = CONFIG.apiEndpoint + path;

            console.log("Making request to:", url);
            console.log(
                "Using JWT token:",
                this.currentUser.idToken.substring(0, 50) + "..."
            );

            const response = await fetch(url, {
                method: method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.currentUser.idToken}`,
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            console.log("Response status:", response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error("Error response:", errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                return await response.json();
            } else {
                return await response.text();
            }
        } catch (error) {
            console.error("Request error:", error);
            throw error;
        }
    }

    async getLibraries() {
        const button = document.getElementById("get-libraries-btn");
        const originalText = button.textContent;
        button.innerHTML = '<span class="loading"></span>Loading...';
        button.disabled = true;

        try {
            const result = await this.makeAuthenticatedRequest(
                "GET",
                "/libraries"
            );
            this.displayApiResponse("Get Libraries", result);
        } catch (error) {
            this.displayApiResponse("Get Libraries Error", {
                error: error.message,
            });
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async getLibraryJson() {
        const ownerId = document.getElementById("owner-id-input").value.trim();
        if (!ownerId) {
            this.showStatus("Please enter an Owner ID", "error");
            return;
        }

        const button = document.getElementById("get-library-json-btn");
        const originalText = button.textContent;
        button.innerHTML = '<span class="loading"></span>Loading...';
        button.disabled = true;

        try {
            const result = await this.makeAuthenticatedRequest(
                "GET",
                `/libraries/${ownerId}/library.json`
            );
            this.displayApiResponse("Get Library JSON", result);
        } catch (error) {
            this.displayApiResponse("Get Library JSON Error", {
                error: error.message,
            });
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async getPlaylist() {
        const ownerId = document.getElementById("owner-id-input").value.trim();
        const movieId = document.getElementById("movie-id-input").value.trim();

        if (!ownerId || !movieId) {
            this.showStatus("Please enter both Owner ID and Movie ID", "error");
            return;
        }

        const button = document.getElementById("get-playlist-btn");
        const originalText = button.textContent;
        button.innerHTML = '<span class="loading"></span>Loading...';
        button.disabled = true;

        try {
            const result = await this.makeAuthenticatedRequest(
                "GET",
                `/libraries/${ownerId}/movies/${movieId}/playlist.m3u8`
            );
            this.displayApiResponse("Get Playlist", result);
        } catch (error) {
            this.displayApiResponse("Get Playlist Error", {
                error: error.message,
            });
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    displayApiResponse(title, data) {
        const responseElement = document.getElementById("api-response");
        const isJson = typeof data === "object";

        responseElement.innerHTML = `
            <h4>${title}</h4>
            <div class="json-display">${
                isJson ? JSON.stringify(data, null, 2) : data
            }</div>
        `;
    }

    // Cognito Authentication Methods
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

// Add some helper functions for debugging
window.debugAuth = {
    getCurrentUser: () => window.mediaLibraryApp?.currentUser,
    getTokens: () => ({
        accessToken: localStorage.getItem("accessToken"),
        idToken: localStorage.getItem("idToken"),
        refreshToken: localStorage.getItem("refreshToken"),
    }),
    clearTokens: () => {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("idToken");
        localStorage.removeItem("refreshToken");
        console.log("Tokens cleared");
    },
};
