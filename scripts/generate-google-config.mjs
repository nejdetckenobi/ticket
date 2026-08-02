import { writeFileSync } from "node:fs";

const environmentVariables = {
  googleClientId: "GOOGLE_CLIENT_ID",
  googleApiKey: "GOOGLE_API_KEY",
  googleAppId: "GOOGLE_APP_ID"
};

const config = Object.fromEntries(
  Object.entries(environmentVariables).map(([configKey, environmentKey]) => [
    configKey,
    process.env[environmentKey]?.trim()
  ])
);

const missingVariables = Object.entries(environmentVariables)
  .filter(([configKey]) => !config[configKey])
  .map(([, environmentKey]) => environmentKey);

if (missingVariables.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingVariables.join(", ")}`
  );
}

const source =
  `window.INVITATION_CONFIG = Object.freeze(${JSON.stringify(config)});\n`;

writeFileSync(new URL("../google-config.js", import.meta.url), source, "utf8");
