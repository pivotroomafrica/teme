import { clsx, type ClassValue } from "clsx";

/** Joins class names, skipping falsy values. */
export const cn = (...inputs: ClassValue[]) => clsx(inputs);
