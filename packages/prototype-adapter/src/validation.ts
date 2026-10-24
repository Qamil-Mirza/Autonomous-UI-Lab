// Shared by the browser app and the server so both enforce the same rules. Keep this file free of Node imports.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const RUN_ID = /^run_[A-Za-z0-9_-]+$/;
export const isRunId = (value: string) => RUN_ID.test(value);
export const isEmail = (value: string) => EMAIL.test(value.trim());
export const isFilled = (value: string) => value.trim().length > 0;
export const MIN_PASSWORD_LENGTH = 8;
