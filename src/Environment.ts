import { Platform } from "@/platform/node";

export const CURRENT_OS_TYPE = await Platform.getOsType();
