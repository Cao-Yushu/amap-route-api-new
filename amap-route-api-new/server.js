const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// CORS配置
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400
};

app.use(cors(corsOptions));

// 中间件配置
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Content-Type', 'application/json; charset=utf-8');
    next();
});

// 健康检查端点
app.get('/', (req, res) => {
    const { callback } = req.query;
    const response = { status: '1', message: 'Service is running' };
    if (callback) {
        res.jsonp(response);
    } else {
        res.json(response);
    }
});

// 会话管理 - 保存基础TMC单价
const sessions = new Map();

// 清理过期会话（每小时运行一次）
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, data] of sessions.entries()) {
        if (now - data.timestamp > 30 * 60 * 1000) { // 30分钟后过期
            sessions.delete(sessionId);
        }
    }
}, 60 * 60 * 1000);

// 生成基础TMC单价
function generateBaseTmcMultiplier(range) {
    let basePrice;
    if (range === 'low') {
        basePrice = Math.random() * 0.25 + 0.01; // 0.01-0.25 约等于燃油车价格单位里程成本一半
    } else if (range === 'mid') {
        basePrice = Math.random() * 0.25 + 0.25 + 0.01; // 0.26-0.51 约等于燃油车价格单位里程成本一倍
    } else if (range === 'high') {
        basePrice = Math.random() * 0.25 + 0.5 + 0.01; // 0.51-1.01 约等于燃油车价格单位里程成本1.5倍
    } else {
        // 默认使用low级别
        basePrice = Math.random() * 0.25 + 0.01;
    }
    return basePrice;
}

// 根据动力类型调整TMC单价
function adjustTmcMultiplier(basePrice, powerType) {
    switch (powerType) {
        case '混动（燃油+电动）':
            return basePrice * 0.7;
        case '纯电动':
            return basePrice * 0.5;
        default: // 燃油车或其他
            return basePrice;
    }
}

// 获取或创建TMC单价
function getBaseTmcMultiplier(sessionId, tmcRange) {
    // 如果没有会话ID，则每次都创建新的单价
    if (!sessionId) {
        return generateBaseTmcMultiplier(tmcRange);
    }
    
    // 检查会话是否存在且有相同的价格水平
    if (sessions.has(sessionId) && sessions.get(sessionId).tmcRange === tmcRange) {
        return sessions.get(sessionId).basePrice;
    }
    
    // 创建新的单价并保存
    const basePrice = generateBaseTmcMultiplier(tmcRange);
    sessions.set(sessionId, {
        basePrice: basePrice,
        tmcRange: tmcRange,
        timestamp: Date.now()
    });
    
    return basePrice;
}

// 主路由处理
app.get('/api/route', async (req, res) => {
    try {
        const { origin, destination, mode, powerType, tmcRange = 'low', hasTmcQuota = 'true', sessionId, callback } = req.query;
        const amapKey = process.env.AMAP_API_KEY;

        // 记录接收到的参数
        console.log('收到请求参数:', {
            origin,
            destination,
            mode,
            powerType,
            tmcRange,
            hasTmcQuota,
            sessionId,
            hasCallback: !!callback
        });

        if (!origin || !destination || !mode) {
            const error = {
                status: "0",
                info: "缺少必要参数",
                type: mode || "unknown",
                route_info: {
                    distance: 0,
                    duration: 0,
                    cost: 0,
                    cost_without_tmc: 0,
                    tmc_multiplier: 0,
                    available: false
                }
            };
            return callback ? res.jsonp(error) : res.json(error);
        }

        // 如果是网约车模式，使用驾车路线的数据
        const actualMode = mode === 'taxi' ? 'driving' : mode;

        let url;
        switch (actualMode) {
            case 'driving':
                url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&extensions=all&key=${amapKey}`;
                break;
            case 'transit':
                url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
                break;
            case 'walking':
                url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
                break;
            case 'bicycling':
            case 'ebike':
                url = `https://restapi.amap.com/v3/direction/riding?origin=${origin}&destination=${destination}&key=${amapKey}`;
                break;
            default:
                const error = {
                    status: "0",
                    info: "无效的出行方式",
                    type: mode,
                    route_info: {
                        distance: 0,
                        duration: 0,
                        cost: 0,
                        cost_without_tmc: 0,
                        tmc_multiplier: 0,
                        available: false
                    }
                };
                return callback ? res.jsonp(error) : res.json(error);
        }

        const response = await axios.get(url);
        const result = response.data;

        if (result.status !== '1') {
            const error = {
                status: "0",
                info: result.info || "路线规划失败",
                type: mode,
                route_info: {
                    distance: 0,
                    duration: 0,
                    cost: 0,
                    cost_without_tmc: 0,
                    tmc_multiplier: 0,
                    available: false
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
                        console.log('API返回的打车费用:', taxiCost);

                        if (taxiCost > 0) {
                            // 获取基础TMC单价
                            const baseTmcPrice = getBaseTmcMultiplier(sessionId, tmcRange);
                            // 出租车统一按混动车计算（基础单价 × 0.7）
                            tmcMultiplier = baseTmcPrice * 0.7;
                            
                            // 将API返回的出租车费用调整为70%
                            const adjustedTaxiCost = taxiCost * 0.7;
                            
                            // 计算TMC成本（如果额度充足则为0）
                            const tmcCost = hasTmcQuota === 'true' ? 0 : distance * tmcMultiplier;
                            cost = adjustedTaxiCost + tmcCost;
                            costWithoutTmc = adjustedTaxiCost;
                            
                            console.log('网约车成本计算:', {
                                originalTaxiCost: taxiCost,
                                adjustedTaxiCost,
                                baseTmcPrice,
                                tmcMultiplier,
                                tmcCost,
                                totalCost: cost,
                                costWithoutTmc: costWithoutTmc,
                                distance,
                                hasTmcQuota
                            });
                        } else {
                            console.log('警告: API未返回打车费用');
                            cost = 0;
                            costWithoutTmc = 0;
                            tmcMultiplier = 0;
                            isAvailable = false;
                        }
                    } else {
                        // 私家车计算逻辑
                        let baseOperationCost;
                        
                        // 设置基础运营成本
                        switch (powerType) {
                            case '混动（燃油+电动）':
                                baseOperationCost = 0.45;
                                break;
                            case '纯电动':
                                baseOperationCost = 0.25;
                                break;
                            default: // 燃油车或其他
                                baseOperationCost = 0.7;
                                break;
                        }

                        // 获取基础TMC单价并根据动力类型调整
                        const baseTmcPrice = getBaseTmcMultiplier(sessionId, tmcRange);
                        tmcMultiplier = adjustTmcMultiplier(baseTmcPrice, powerType);
                        
                        // 计算TMC成本（如果额度充足则为0）
                        const tmcCost = hasTmcQuota === 'true' ? 0 : distance * tmcMultiplier;
                        const operationCost = baseOperationCost * distance;
                        cost = tmcCost + operationCost;
                        costWithoutTmc = operationCost;
                        
                        console.log('私家车成本计算:', {
                            powerType,
                            baseTmcPrice,
                            tmcMultiplier,
                            tmcCost,
                            operationCost,
                            totalCost: cost,
                            costWithoutTmc: costWithoutTmc,
                            distance,
                            hasTmcQuota
                        });
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
                        console.log('警告: 公交路线不可用 - 时间或费用为0');
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
                        duration = Math.ceil(duration * 0.6);
                        cost = 0.08 * distance;
                        costWithoutTmc = cost;
                        tmcMultiplier = 0;
                    } else {
                        cost = 1;  // 自行车基础出行成本设为1元
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

        console.log('返回的路线信息:', routeInfo);

        if (callback) {
            res.jsonp(routeInfo);
        } else {
            res.json(routeInfo);
        }

    } catch (error) {
        console.error('处理请求时发生错误:', error);
        const errorResponse = {
            status: "0",
            info: "服务器错误",
            type: req.query.mode || "unknown",
            route_info: {
                distance: 0,
                duration: 0,
                cost: 0,
                cost_without_tmc: 0,
                tmc_multiplier: 0,
                available: false
            }
        };
        if (req.query.callback) {
            res.jsonp(errorResponse);
        } else {
            res.json(errorResponse);
        }
    }
});

// 添加调试端点
app.get('/debug/route', async (req, res) => {
    try {
        const { origin, destination, mode } = req.query;
        const amapKey = process.env.AMAP_API_KEY;

        if (!origin || !destination || !mode) {
            return res.json({
                error: "Missing required parameters",
                params: { origin, destination, mode }
            });
        }

        const actualMode = mode === 'taxi' ? 'driving' : mode;
        
        let url;
        switch (actualMode) {
            case 'driving':
                url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&extensions=all&key=${amapKey}`;
                break;
            case 'transit':
                url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
                break;
            case 'walking':
                url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
                break;
            case 'bicycling':
            case 'ebike':
                url = `https://restapi.amap.com/v3/direction/riding?origin=${origin}&destination=${destination}&key=${amapKey}`;
                break;
            default:
                return res.json({
                    error: "Invalid mode",
                    mode: mode
                });
        }

        const response = await axios.get(url);
        
        // 返回原始API响应和处理后的数据
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
    console.log(`Server is running on port ${port}`);
});
