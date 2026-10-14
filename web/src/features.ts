// Feature flags for the UI. Backend code for hidden features remains intact.
//
// Google Drive is temporarily hidden from the app. All Drive code (backend routes,
// upload logic, and the Drive page) is left in place — flip this to `true` to bring
// the Google Drive UI back everywhere it appears (nav, route, dashboard, backups).
export const DRIVE_ENABLED = false;
