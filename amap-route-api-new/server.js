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

// 主路由处理
app.get('/api/route', async (req, res) => {
    try {
        const { origin, destination, mode, powerType, tmcLevel = '1', callback } = req.query;
        const amapKey = process.env.AMAP_API_KEY;

        // 记录接收到的参数
        console.log('收到请求参数:', {
            origin,
            destination,
            mode,
            powerType,
            tmcLevel,
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
                    cost: 0
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
                        cost: 0
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
                    cost: 0
                }
            };
            return callback ? res.jsonp(error) : res.json(error);
        }

        let distance = 0;
        let duration = 0;
        let cost = 0;
        let costWithoutTmc = 0; // 添加不含TMC的成本
        let isAvailable = true; // 添加可用性标志

        switch (actualMode) {
            case 'driving':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60);

                    if (mode === 'taxi') {
                        // 记录原始API返回的打车费用
                        const taxiCost = result.route.taxi_cost ? parseFloat(result.route.taxi_cost) : 0;
                        console.log('API返回的打车费用:', taxiCost);

                        if (taxiCost > 0) {
                            // 计算混动车TMC成本
                            const baseTmcPrice = 0.35; // 混动车基准TMC价格
                            let tmcMultiplier;
                            switch (tmcLevel) {
                                case '2':
                                    tmcMultiplier = 2;
                                    break;
                                case '4':
                                    tmcMultiplier = 4;
                                    break;
                                default:
                                    tmcMultiplier = 1;
                            }
                            const tmcCost = baseTmcPrice * distance * tmcMultiplier;
                            
                            // 总成本 = 打车费用 + TMC成本
                            cost = taxiCost + tmcCost;
                            costWithoutTmc = taxiCost; // 不含TMC的成本仅为打车费用

                            console.log('网约车成本计算:', {
                                taxiCost,
                                tmcCost,
                                totalCost: cost,
                                costWithoutTmc: costWithoutTmc,
                                distance,
                                tmcMultiplier
                            });
                        } else {
                            console.log('警告: API未返回打车费用');
                            cost = 0;
                            costWithoutTmc = 0;
                            isAvailable = false;
                        }
                    } else {
                        // 普通驾车成本计算
                        let baseTmcPrice;
                        let baseOperationCost;
                        if (powerType === '燃油') {
                            baseTmcPrice = 0.5;
                            baseOperationCost = 0.7;
                        } else if (powerType === '混动（燃油+电动）') {
                            baseTmcPrice = 0.35;
                            baseOperationCost = 0.45;
                        } else if (powerType === '纯电动') {
                            baseTmcPrice = 0.25;
                            baseOperationCost = 0.25;
                        } else {
                            baseTmcPrice = 0.5;
                            baseOperationCost = 0.7;
                        }

                        let tmcMultiplier;
                        switch (tmcLevel) {
                            case '2':
                                tmcMultiplier = 2;
                                break;
                            case '4':
                                tmcMultiplier = 4;
                                break;
                            default:
                                tmcMultiplier = 1;
                        }

                        const tmcCost = baseTmcPrice * distance * tmcMultiplier;
                        const operationCost = baseOperationCost * distance;
                        cost = tmcCost + operationCost;
                        costWithoutTmc = operationCost; // 不含TMC的成本仅为运营成本

                        console.log('驾车成本计算:', {
                            tmcCost,
                            operationCost,
                            totalCost: cost,
                            costWithoutTmc: costWithoutTmc
                        });
                    }
                }
                break;
            case 'transit':
                if (result.route && result.route.transits && result.route.transits[0]) {
                    distance = parseFloat(result.route.transits[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.transits[0].duration) / 60);
                    // 使用API返回的实际公交费用
                    cost = result.route.transits[0].cost ? parseFloat(result.route.transits[0].cost) : 3;
                    costWithoutTmc = cost; // 公交模式没有TMC成本，两者相同
                    
                    // 检查公交路线是否可用
                    if (duration === 0 || cost === 0) {
                        console.log('警告: 公交路线不可用 - 时间或费用为0');
                        isAvailable = false;
                    }

                    console.log('公交路线信息:', {
                        rawCost: result.route.transits[0].cost,
                        parsedCost: cost,
                        duration: duration,
                        isAvailable: isAvailable,
                        transitInfo: result.route.transits[0]
                    });
                } else {
                    isAvailable = false;
                }
                break;
            case 'walking':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60);
                    cost = 0;
                    costWithoutTmc = 0; // 步行没有TMC成本
                }
                break;
            case 'bicycling':
            case 'ebike':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60);
                    
                    if (mode === 'ebike') {
                        // 电动自行车速度是普通自行车的1.67倍（时间为0.6倍）
                        duration = Math.ceil(duration * 0.6);
                        cost = 0.08 * distance; // 电动自行车每公里0.08元电费
                        costWithoutTmc = cost; // 电动自行车没有TMC成本
                    } else {
                        cost = 0;
                        costWithoutTmc = 0; // 自行车没有TMC成本
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
                cost_without_tmc: isAvailable ? parseFloat(costWithoutTmc.toFixed(1)) : 0, // 添加不含TMC的成本
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
                cost_without_tmc: 0, // 添加不含TMC的成本字段
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
