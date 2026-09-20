import packageJson from "../../package.json";

/** The package manifest is the canonical application version source. */
export const APP_VERSION = packageJson.version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
