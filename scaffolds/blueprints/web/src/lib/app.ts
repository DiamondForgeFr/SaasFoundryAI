/**
 * The product name your users read: `VITE_APP_NAME` from `.env`, the project name by default.
 * Change the variable to rename the product; nothing is regenerated (#886).
 */
export const APP_NAME: string = import.meta.env.VITE_APP_NAME || '{{PROJECT_NAME}}'
