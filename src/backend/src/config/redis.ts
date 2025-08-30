// redis.service.ts
import { createClient } from 'redis';

const REDIS_URL = process.env['REDIS_URL'];

if (!REDIS_URL) {
    throw new Error('Missing REDIS_URL in environment variables');
}

// Create Redis client
const redis = createClient({
    url: REDIS_URL
});

redis.on('error', (err: Error) => console.error('Redis Client Error', err));
redis.on('connect', () => console.log('Redis connected'));
redis.on('ready', () => console.log('Redis ready'));

// Initialize connection
let isConnected = false;

export const initRedis = async (): Promise<void> => {
    if (!isConnected) {
        await redis.connect();
        isConnected = true;
        console.log('Redis connection established');
    }
};

export const closeRedis = async (): Promise<void> => {
    if (isConnected) {
        await redis.quit();
        isConnected = false;
        console.log('Redis connection closed');
    }
};

export const getRedisClient = () => {
    if (!isConnected) {
        throw new Error('Redis not connected. Call initRedis() first.');
    }
    return redis;
};
