const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// ==================== 配置参数 ====================
const CONFIG = {
    CACHE_TTL: 600,              // 缓存10分钟（600秒）
    SESSION_TTL: 1800,           // 会话30分钟
    CLEANUP_INTERVAL: 3600000,   // 每小时清理一次（毫秒）
    MAX_RETRIES: 2,              // 高德API调用重试次数
    RETRY_DELAY: 1000,           // 重试延迟1秒
    AMAP_TIMEOUT: 10000          // 高德API超时10秒
};

// ==================== 内存缓存（简单版，无需Redis） ====================
const routeCache = new Map();

// 定期清理过期缓存
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of routeCache.entries()) {
        if (now - value.timestamp > CONFIG.CACHE_TTL * 1000) {
            routeCache.delete(key);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log('🧹 清理了 ' + cleaned + ' 条过期缓存');
    }
}, CONFIG.CLEANUP_INTERVAL);

// ==================== 会话管理 ====================
const sessions = new Map();

// 清理过期会话
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, data] of sessions.entries()) {
        if (now - data.timestamp > CONFIG.SESSION_TTL * 1000) {
            sessions.delete(sessionId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log('🧹 清理了 ' + cleaned + ' 个过期会话');
    }
}, CONFIG.CLEANUP_INTERVAL);

// ==================== CORS配置 ====================
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Content-Type', 'application/json; charset=utf-8');
    next();
});

// ==================== 统计信息 ====================
var stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    amapCalls: 0,
    errors: 0,
    startTime: Date.now()
};

// ==================== TMC单价生成函数 ====================
function generateBaseTmcMultiplier(range) {
    let basePrice;
    if (range === 'low') {
        basePrice = Math.random() * 0.5 + 0.01;
    } else if (range === 'mid') {
        basePrice = Math.random() * 0.5 + 0.5 + 0.01;
    } else if (range === 'high') {
        basePrice = Math.random() * 0.5 + 1 + 0.01;
    } else {
        basePrice = Math.random() * 0.5 + 0.01;
    }
    return basePrice;
}

function adjustTmcMultiplier(basePrice, powerType) {
    switch (powerType) {
        case '混动（燃油+电动）':
            return basePrice * 0.7;
        case '纯电动':
            return basePrice * 0.5;
        default:
            return basePrice;
    }
}

function getBaseTmcMultiplier(sessionId, tmcRange) {
    if (!sessionId) {
        return generateBaseTmcMultiplier(tmcRange);
    }
    
    if (sessions.has(sessionId) && sessions.get(sessionId).tmcRange === tmcRange) {
        return sessions.get(sessionId).basePrice;
    }
    
    const basePrice = generateBaseTmcMultiplier(tmcRange);
    sessions.set(sessionId, {
        basePrice: basePrice,
        tmcRange: tmcRange,
        timestamp: Date.now()
    });
    
    return basePrice;
}

// ==================== 带重试的高德API调用 ====================
async function fetchAmapWithRetry(url, retryCount = 0) {
    try {
        stats.amapCalls++;
        
        const response = await axios.get(url, {
            timeout: CONFIG.AMAP_TIMEOUT
        });
        
        return response.data;
        
    } catch (error) {
        console.error('高德API调用失败 (尝试 ' + (retryCount + 1) + '/' + (CONFIG.MAX_RETRIES + 1) + '):', error.message);
        
        // 重试机制
        if (retryCount < CONFIG.MAX_RETRIES) {
            console.log('🔄 ' + CONFIG.RETRY_DELAY/1000 + '秒后重试...');
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return fetchAmapWithRetry(url, retryCount + 1);
        }
        
        throw error;
    }
}

// ==================== 健康检查端点 ====================
app.get('/', (req, res) => {
    const { callback } = req.query;
    
    const hitRate = stats.totalRequests > 0 ? 
        ((stats.cacheHits / stats.totalRequests * 100).toFixed(1) + '%') : 'N/A';
    
    const response = { 
        status: '1', 
        message: 'Service is running',
        stats: {
            totalRequests: stats.totalRequests,
            cacheHits: stats.cacheHits,
            cacheMisses: stats.cacheMisses,
            cacheHitRate: hitRate,
            amapCalls: stats.amapCalls,
            errors: stats.errors,
            uptime: Math.floor((Date.now() - stats.startTime) / 1000) + 's',
            cacheSize: routeCache.size
        }
    };
    
    if (callback) {
        res.jsonp(response);
    } else {
        res.json(response);
    }
});

// ==================== 主路由处理（带缓存） ====================
app.get('/api/route', async (req, res) => {
    try {
        stats.totalRequests++;
        
        const { origin, destination, mode, powerType, tmcRange = 'low', hasTmcQuota = 'true', sessionId, callback } = req.query;
        const amapKey = process.env.AMAP_API_KEY;

        console.log('收到请求 #' + stats.totalRequests + ':', {
            origin: origin,
            destination: destination,
            mode: mode,
            sessionId: sessionId
        });

        if (!origin || !destination || !mode) {
            stats.errors++;
            const error = {
                status: "0",
                info: "缺少必要参数",
                type: mode || "unknown",
                route_info: {
                    distance: 0, duration: 0, cost: 0, 
                    cost_without_tmc: 0, tmc_multiplier: 0, available: false
                }
            };
            return callback ? res.jsonp(error) : res.json(error);
        }

        // ✅ 生成缓存键（不包含sessionId，提高命中率）
        const cacheKey = origin + ':' + destination + ':' + mode + ':' + powerType + ':' + tmcRange + ':' + hasTmcQuota;
        
        // ✅ 检查缓存
        if (routeCache.has(cacheKey)) {
            const cached = routeCache.get(cacheKey);
            
            // 检查是否过期
            if (Date.now() - cached.timestamp < CONFIG.CACHE_TTL * 1000) {
                stats.cacheHits++;
                console.log('✅ 缓存命中 (' + stats.cacheHits + '/' + stats.totalRequests + '), 键:', cacheKey.substring(0, 50) + '...');
                return callback ? res.jsonp(cached.data) : res.json(cached.data);
            } else {
                // 过期，删除
                routeCache.delete(cacheKey);
            }
        }
        
        stats.cacheMisses++;
        console.log('⚪ 缓存未命中，调用高德API (' + stats.cacheMisses + '/' + stats.totalRequests + ')');

        const actualMode = mode === 'taxi' ? 'driving' : mode;
        let url;
        
        switch (actualMode) {
            case 'driving':
                url = 'https://restapi.amap.com/v3/direction/driving?origin=' + origin + '&destination=' + destination + '&extensions=all&key=' + amapKey;
                break;
            case 'transit':
                url = 'https://restapi.amap.com/v3/direction/transit/integrated?origin=' + origin + '&destination=' + destination + '&city=0755&extensions=all&key=' + amapKey;
                break;
            case 'walking':
                url = 'https://restapi.amap.com/v3/direction/walking?origin=' + origin + '&destination=' + destination + '&key=' + amapKey;
                break;
            case 'bicycling':
            case 'ebike':
                url = 'https://restapi.amap.com/v3/direction/riding?origin=' + origin + '&destination=' + destination + '&key=' + amapKey;
                break;
            default:
                stats.errors++;
                const error = {
                    status: "0",
                    info: "无效的出行方式",
                    type: mode,
                    route_info: {
                        distance: 0, duration: 0, cost: 0,
                        cost_without_tmc: 0, tmc_multiplier: 0, available: false
                    }
                };
                return callback ? res.jsonp(error) : res.json(error);
        }

        // ✅ 带重试的API调用
        const result = await fetchAmapWithRetry(url);

        if (result.status !== '1') {
            stats.errors++;
            const error = {
                status: "0",
                info: result.info || "路线规划失败",
                type: mode,
                route_info: {
                    distance: 0, duration: 0, cost: 0,
                    cost_without_tmc: 0, tmc_multiplier: 0, available: false
                }
            };
            return callback ? res.jsonp(error) : res.json(error);
        }

        let distance = 0;
        let duration = 0;
        let cost = 0;
        let costWithoutTmc = 0;
        let tmcMultiplier = 0;
        let isAvailable = true;

        switch (actualMode) {
            case 'driving':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60);

                    if (mode === 'taxi') {
                        const taxiCost = result.route.taxi_cost ? parseFloat(result.route.taxi_cost) : 0;
                        if (taxiCost > 0) {
                            const baseTmcPrice = getBaseTmcMultiplier(sessionId, tmcRange);
                            tmcMultiplier = baseTmcPrice * 0.7;
                            const adjustedTaxiCost = taxiCost * 0.65;
                            const tmcCost = hasTmcQuota === 'true' ? 0 : distance * tmcMultiplier;
                            cost = adjustedTaxiCost + tmcCost;
                            costWithoutTmc = adjustedTaxiCost;
                        } else {
                            isAvailable = false;
                        }
                    } else {
                        let baseOperationCost;
                        switch (powerType) {
                            case '混动（燃油+电动）':
                                baseOperationCost = 0.45;
                                break;
                            case '纯电动':
                                baseOperationCost = 0.25;
                                break;
                            default:
                                baseOperationCost = 0.7;
                                break;
                        }
                        const baseTmcPrice = getBaseTmcMultiplier(sessionId, tmcRange);
                        tmcMultiplier = adjustTmcMultiplier(baseTmcPrice, powerType);
                        const tmcCost = hasTmcQuota === 'true' ? 0 : distance * tmcMultiplier;
                        const operationCost = baseOperationCost * distance;
                        cost = tmcCost + operationCost;
                        costWithoutTmc = operationCost;
                    }
                }
                break;
            case 'transit':
                if (result.route && result.route.transits && result.route.transits[0]) {
                    distance = parseFloat(result.route.transits[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.transits[0].duration) / 60);
                    cost = result.route.transits[0].cost ? parseFloat(result.route.transits[0].cost) : 3;
                    costWithoutTmc = cost;
                    tmcMultiplier = 0;
                    if (duration === 0 || cost === 0) {
                        isAvailable = false;
                    }
                } else {
                    isAvailable = false;
                }
                break;
            case 'walking':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60);
                    cost = 0;
                    costWithoutTmc = 0;
                    tmcMultiplier = 0;
                }
                break;
            case 'bicycling':
            case 'ebike':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60);
                    if (mode === 'ebike') {
                        duration = Math.ceil(duration * 0.725);
                        cost = 0.08 * distance;
                        costWithoutTmc = cost;
                        tmcMultiplier = 0;
                    } else {
                        cost = 1;
                        costWithoutTmc = 1;
                        tmcMultiplier = 0;
                    }
                }
                break;
        }

        const routeInfo = {
            status: "1",
            info: isAvailable ? "OK" : "路线不可用",
            type: mode,
            route_info: {
                distance: parseFloat(distance.toFixed(1)),
                duration: isAvailable ? duration : 0,
                cost: isAvailable ? parseFloat(cost.toFixed(1)) : 0,
                cost_without_tmc: isAvailable ? parseFloat(costWithoutTmc.toFixed(1)) : 0,
                tmc_multiplier: isAvailable ? parseFloat(tmcMultiplier.toFixed(3)) : 0,
                available: isAvailable
            }
        };

        console.log('返回路线信息:', mode, '距离:', distance.toFixed(1) + 'km');

        // ✅ 存入缓存
        routeCache.set(cacheKey, {
            data: routeInfo,
            timestamp: Date.now()
        });
        console.log('💾 数据已缓存，当前缓存大小:', routeCache.size);

        if (callback) {
            res.jsonp(routeInfo);
        } else {
            res.json(routeInfo);
        }

    } catch (error) {
        stats.errors++;
        console.error('处理请求时发生错误:', error.message);
        
        const errorResponse = {
            status: "0",
            info: "服务器错误: " + error.message,
            type: req.query.mode || "unknown",
            route_info: {
                distance: 0, duration: 0, cost: 0,
                cost_without_tmc: 0, tmc_multiplier: 0, available: false
            }
        };
        
        if (req.query.callback) {
            res.jsonp(errorResponse);
        } else {
            res.json(errorResponse);
        }
    }
});

// ==================== 统计端点 ====================
app.get('/stats', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const hitRate = stats.totalRequests > 0 ? 
        ((stats.cacheHits / stats.totalRequests * 100).toFixed(1) + '%') : 'N/A';
    const errorRate = stats.totalRequests > 0 ?
        ((stats.errors / stats.totalRequests * 100).toFixed(1) + '%') : 'N/A';
    
    res.json({
        totalRequests: stats.totalRequests,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        cacheHitRate: hitRate,
        amapCalls: stats.amapCalls,
        errors: stats.errors,
        errorRate: errorRate,
        uptime: uptime + 's',
        cacheSize: routeCache.size,
        sessionSize: sessions.size,
        timestamp: new Date().toISOString()
    });
});

// ==================== 缓存管理端点 ====================
app.get('/cache/clear', (req, res) => {
    const keysDeleted = routeCache.size;
    routeCache.clear();
    
    res.json({
        message: 'Cache cleared',
        keysDeleted: keysDeleted,
        timestamp: new Date().toISOString()
    });
});

app.get('/cache/stats', (req, res) => {
    res.json({
        size: routeCache.size,
        ttl: CONFIG.CACHE_TTL + 's',
        timestamp: new Date().toISOString()
    });
});

// ==================== 调试端点 ====================
app.get('/debug/route', async (req, res) => {
    try {
        const { origin, destination, mode } = req.query;
        const amapKey = process.env.AMAP_API_KEY;

        if (!origin || !destination || !mode) {
            return res.json({
                error: "Missing required parameters",
                params: { origin: origin, destination: destination, mode: mode }
            });
        }

        const actualMode = mode === 'taxi' ? 'driving' : mode;
        
        let url;
        switch (actualMode) {
            case 'driving':
                url = 'https://restapi.amap.com/v3/direction/driving?origin=' + origin + '&destination=' + destination + '&extensions=all&key=' + amapKey;
                break;
            case 'transit':
                url = 'https://restapi.amap.com/v3/direction/transit/integrated?origin=' + origin + '&destination=' + destination + '&city=0755&extensions=all&key=' + amapKey;
                break;
            case 'walking':
                url = 'https://restapi.amap.com/v3/direction/walking?origin=' + origin + '&destination=' + destination + '&key=' + amapKey;
                break;
            case 'bicycling':
            case 'ebike':
                url = 'https://restapi.amap.com/v3/direction/riding?origin=' + origin + '&destination=' + destination + '&key=' + amapKey;
                break;
            default:
                return res.json({
                    error: "Invalid mode",
                    mode: mode
                });
        }

        const response = await axios.get(url);
        
        res.json({
            raw_amap_response: response.data,
            url_called: url
        });

    } catch (error) {
        res.json({
            error: error.message,
            stack: error.stack
        });
    }
});

app.listen(port, () => {
    console.log('========================================');
    console.log('✅ Server is running on port ' + port);
    console.log('📊 Cache TTL: ' + CONFIG.CACHE_TTL + 's');
    console.log('🔧 Max retries: ' + CONFIG.MAX_RETRIES);
    console.log('⏱️  API timeout: ' + CONFIG.AMAP_TIMEOUT/1000 + 's');
    console.log('========================================');
});
