/**
 * A native WebHID chooser may only be requested from the explicit user action
 * that will execute it immediately. Loading definitions must never defer it to
 * a later automatic scan.
 */
export const canRequestDeviceAuthorization = (definitionsReady: boolean) =>
  definitionsReady;
