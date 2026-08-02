# TicketToken

This is a static web application for generating and validating invitation QR
codes. Validation history is stored locally by default. It can also append
successful validations to a user-selected Google Sheets spreadsheet.

## Google Sheets setup

1. Create or select a project in Google Cloud Console.
2. Enable **Google Picker API** and **Google Sheets API**.
3. Configure an OAuth consent screen.
4. Create an OAuth 2.0 Client ID of type **Web application** and add every
   deployed HTTPS origin to its authorized JavaScript origins.
5. Create an API key and restrict it to the deployed website origins and the
   Google Picker API.
6. Configure the OAuth Client ID, API key, and numeric Cloud project number as
   described below.

### Netlify deployment

Add these environment variables in **Project configuration > Environment
variables** and make them available to the **Builds** scope:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_API_KEY`
- `GOOGLE_APP_ID`

The build command in `netlify.toml` generates `google-config.js` from those
values before Netlify publishes the site. The generated file is ignored by Git
and must not be committed. A deployment fails early when any value is missing.

### Local development

Copy `google-config.example.js` to `google-config.js` and fill in the local
values. Because `google-config.js` is ignored by Git, those values remain only
on the local machine.

These values identify a browser application and are not server-side secrets.
Their origin and API restrictions are still required to prevent unauthorized
use. Google OAuth access tokens are kept in memory only and are never written
to local storage.

The app requests the `drive.file` OAuth scope. Users must select a native
Google Sheets file through the picker; uploaded `.xlsx` files are not accepted.
The first worksheet receives `event`, `full_name`, `scanned_at`, and `token`
columns. When Google storage and duplicate prevention are enabled, that token
column is used for cross-device duplicate checks.

Camera access, Google authorization, and Google Picker require the deployed app
to be served from an authorized HTTPS origin (localhost may be used during
development where supported).

The public privacy policy is available at `/privacy.html`. Keep its statements
and effective date in sync with any changes to the application's data handling.
