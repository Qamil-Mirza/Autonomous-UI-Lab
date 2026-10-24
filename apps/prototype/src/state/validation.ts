const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (value: string) => EMAIL.test(value.trim());
export const isFilled = (value: string) => value.trim().length > 0;
export const MIN_PASSWORD_LENGTH = 8;
