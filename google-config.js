/* Public browser credentials: restrict both values to the deployed origins/APIs. */
window.GOOGLE_STORAGE_CONFIG = Object.freeze({
  clientId: "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  apiKey: "REPLACE_WITH_GOOGLE_API_KEY",
  appId: "REPLACE_WITH_GOOGLE_CLOUD_PROJECT_NUMBER",
  scopes: [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets"
  ],
  discoveryDocs: [
    "https://sheets.googleapis.com/$discovery/rest?version=v4",
    "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"
  ]
});
