# Invitation Ticket

The application can keep validation history either in browser `localStorage` or in a Google Sheets spreadsheet. “Excel document” in the UI workflow means a native Google Sheets file: the Picker is restricted to `application/vnd.google-apps.spreadsheet`. Sheets API cannot append directly to an `.xlsx` file; supporting that format would require a separate download, edit, and upload workflow.

## Google Cloud setup

1. Create or choose a Google Cloud project and enable **Google Picker API**, **Google Drive API**, and **Google Sheets API**.
2. Configure the OAuth consent screen. Add the application's users as test users while the app is in testing.
3. Create a **Web application** OAuth client. Add every exact deployment origin (scheme, host, and port), such as `https://tickets.example.com`, under **Authorized JavaScript origins**. This GIS token flow does not use a client-side redirect URI; if the Cloud console or a future redirect flow requires one, register the exact HTTPS application URL and never use a wildcard.
4. Create a browser API key, restrict it to the same website origins, and restrict it to Picker, Drive, and Sheets APIs.
5. Set the public `clientId`, `apiKey`, and numeric project `appId` in `google-config.js`. These identifiers are deliberately configurable browser constants, not secrets. **Never put a client secret in this repository or any browser application.**
6. Serve the application over HTTPS. If the Content Security Policy changes, retain the official Google origins already declared in `index.html` for GIS, Picker, API scripts, frames, and API requests.

The requested scopes are `drive.file` (files opened/created through this app) and `spreadsheets` (sheet values and structure). The short-lived access token exists only in memory and is never written to `localStorage`.

On first use the app selects or creates a `History` worksheet, preserves compatible existing columns, and requires `event`, `full_name`, `scanned_at`, and `token`. Data is appended according to the actual header order. Clearing history clears rows 2 onward and leaves both the header and spreadsheet intact.

## Checks

Run the dependency-free static and behavior checks with:

```sh
node --test tests/*.test.js
```
