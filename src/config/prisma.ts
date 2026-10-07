import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { Resolver } from "node:dns/promises";

const dnsResolver = new Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

const customLookup = (hostname: string, options: any, callback: any) => {
    const cb = typeof options === "function" ? options : callback;
    const opt = typeof options === "object" ? options : {};
    dnsResolver.resolve4(hostname)
        .then((ips) => {
            if (opt?.all) {
                cb(null, ips.map((a) => ({ address: a, family: 4 })));
            } else {
                cb(null, ips[0], 4);
            }
        })
        .catch((err) => cb(err));
};

class ResilientWebSocket extends WebSocket {
    constructor(address: any, protocols?: any, options?: any) {
        const opts = (typeof protocols === "object" && !Array.isArray(protocols) ? protocols : options) || {};
        opts.lookup = customLookup;
        super(address, Array.isArray(protocols) ? protocols : undefined, opts);
    }
}

neonConfig.webSocketConstructor = ResilientWebSocket as any;

const connectionString = process.env.DATABASE_URL || process.env.DB_URI;
const adapter = new PrismaNeon({ connectionString });

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;



