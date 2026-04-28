/**
 * import จากไฟล์ generate โดยตรง (relative + .js) เพื่อให้ TS ใช้ index.d.ts คู่กัน
 * ไม่ผ่าน exports ของแพ็กเกจที่มีเงื่อนไข "browser"
 */
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
