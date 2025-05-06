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
        const { origin, destination, mode, powerType, callback } = req.query;
        const amapKey = process.env.AMAP_API_KEY;

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

        switch (actualMode) {
            case 'driving':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000; // 转换为公里
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60); // 转换为分钟

                    // 基础TMC价格
                    const baseTmcPrice = 2.0; // 基础TMC价格，每公里2元
                    let tmcMultiplier = 1;

                    // 根据动力类型设置价格倍数
                    if (powerType === '燃油') {
                        tmcMultiplier = 2; // 燃油车2倍
                    } else if (powerType === '混动（燃油+电动）') {
                        tmcMultiplier = 1.5; // 混动车1.5倍
                    } else if (powerType === '纯电动') {
                        tmcMultiplier = 1; // 电动车基础价格
                    }

                    const tmcCost = baseTmcPrice * distance * tmcMultiplier;
                    const fuelCost = 1.5 * distance; // 假设每公里1.5元燃油成本
                    const depreciationCost = 2 * distance; // 假设每公里2元折旧成本
                    cost = tmcCost + fuelCost + depreciationCost;
                }
                break;
            case 'transit':
                if (result.route && result.route.transits && result.route.transits[0]) {
                    distance = parseFloat(result.route.transits[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.transits[0].duration) / 60);
                    cost = 3; // 假设公交单程3元
                }
                break;
            case 'walking':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60);
                    cost = 0;
                }
                break;
            case 'bicycling':
            case 'ebike':
                if (result.route && result.route.paths && result.route.paths[0]) {
                    distance = parseFloat(result.route.paths[0].distance) / 1000;
                    duration = Math.ceil(parseFloat(result.route.paths[0].duration) / 60);
                    cost = mode === 'ebike' ? 0.5 * distance : 0; // 电动自行车每公里0.5元电费
                }
                break;
        }

        // 如果是网约车模式，使用特殊的计价规则
        if (mode === 'taxi') {
            cost = 10 + 2.5 * distance; // 起步价10元，每公里2.5元
        }

        const routeInfo = {
            status: "1",
            info: "OK",
            type: mode,
            route_info: {
                distance: parseFloat(distance.toFixed(1)),
                duration: duration,
                cost: parseFloat(cost.toFixed(1))
            }
        };

        if (callback) {
            res.jsonp(routeInfo);
        } else {
            res.json(routeInfo);
        }

    } catch (error) {
        console.error('Error:', error);
        const errorResponse = {
            status: "0",
            info: "服务器错误",
            type: req.query.mode || "unknown",
            route_info: {
                distance: 0,
                duration: 0,
                cost: 0
            }
        };
        if (req.query.callback) {
            res.jsonp(errorResponse);
        } else {
            res.json(errorResponse);
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
