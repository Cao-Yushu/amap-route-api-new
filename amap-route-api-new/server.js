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
    const response = { status: 'ok', message: 'Service is running' };
    
    if (callback) {
        res.jsonp(response);
    } else {
        res.json(response);
    }
});

// 主路由处理
app.get('/api/route', async (req, res) => {
    try {
        const { origin, destination, mode, callback, powerType } = req.query;
        const amapKey = process.env.AMAP_API_KEY;

        if (!origin || !destination || !mode) {
            const error = {
                status: "0",
                info: "缺少必要参数",
                type: mode || "unknown",
                route_info: {}
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
                    route_info: {}
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
                route_info: {}
            };
            return callback ? res.jsonp(error) : res.json(error);
        }

        // 处理不同出行方式的返回数据
        let routeInfo = {};
        switch (mode) {
            case 'driving':
                const path = result.route.paths[0];
                const distance = parseFloat(path.distance) / 1000;
                const duration = Math.ceil(parseInt(path.duration) / 60);
                const fuelCost = (distance * 7.79 * 8.0) / 100; // 油费计算

                // 根据动力类型计算 TMC 单价
                let tmcUnitPrice = 0.5; // 默认燃油车
                if (powerType) {
                    switch(powerType) {
                        case '混动（燃油+电动）':
                            tmcUnitPrice = 0.35;
                            break;
                        case '纯电动':
                            tmcUnitPrice = 0.25;
                            break;
                        default: // 燃油
                            tmcUnitPrice = 0.5;
                    }
                }

                const depreciationCost = distance * tmcUnitPrice;

                routeInfo = {
                    distance: distance.toFixed(2),
                    duration,
                    cost_tmc1: (distance + fuelCost + depreciationCost).toFixed(2),
                    cost_tmc2: ((distance * 2) + fuelCost + depreciationCost).toFixed(2),
                    cost_tmc3: ((distance * 3) + fuelCost + depreciationCost).toFixed(2),
                    fuel_cost: fuelCost.toFixed(2),
                    depreciation_cost: depreciationCost.toFixed(2),
                    tmc_unit_price: tmcUnitPrice
                };
                break;

            case 'taxi':
                const taxiPath = result.route.paths[0];
                const taxiDistance = parseFloat(taxiPath.distance) / 1000;
                const taxiDuration = Math.ceil(parseInt(taxiPath.duration) / 60);
                const taxiCost = result.route.taxi_cost ? parseFloat(result.route.taxi_cost) : 0;

                routeInfo = {
                    distance: taxiDistance.toFixed(2),
                    duration: taxiDuration,
                    cost_tmc1: taxiCost.toFixed(2),
                    cost_tmc2: (taxiCost + taxiDistance).toFixed(2),
                    cost_tmc3: (taxiCost + taxiDistance * 2).toFixed(2),
                    taxi_cost: taxiCost.toFixed(2)
                };
                break;

            case 'transit':
                const transitPath = result.route.transits[0];
                const transitDuration = Math.ceil(parseInt(transitPath.duration) / 60);
                const transitDistance = parseFloat(transitPath.distance) / 1000;
                const walkingDistance = (transitPath.walking_distance || 0) / 1000;
                
                routeInfo = {
                    distance: transitDistance.toFixed(2),
                    duration: transitDuration,
                    cost: transitPath.cost || "2.00",
                    walking_distance: walkingDistance.toFixed(2)
                };
                break;

            case 'walking':
                const walkPath = result.route.paths[0];
                const walkDuration = Math.ceil(parseInt(walkPath.duration) / 60);
                const walkDistance = parseFloat(walkPath.distance) / 1000;
                
                routeInfo = {
                    distance: walkDistance.toFixed(2),
                    duration: walkDuration,
                    cost: "0.00"
                };
                break;

            case 'bicycling':
                const bikePath = result.route.paths[0];
                const bikeDuration = Math.ceil(parseInt(bikePath.duration) / 60);
                const bikeDistance = parseFloat(bikePath.distance) / 1000;
                
                routeInfo = {
                    distance: bikeDistance.toFixed(2),
                    duration: bikeDuration,
                    cost: "0.00"
                };
                break;

            case 'ebike':
                const ebikePath = result.route.paths[0];
                const ebikeDuration = Math.ceil(parseInt(ebikePath.duration) / 60);
                const ebikeDistance = parseFloat(ebikePath.distance) / 1000;
                
                routeInfo = {
                    distance: ebikeDistance.toFixed(2),
                    duration: ebikeDuration,
                    cost: (ebikeDistance * 0.1).toFixed(2) // 电动自行车成本：0.1元/km
                };
                break;
        }

        const responseData = {
            status: "1",
            info: "OK",
            type: mode,
            route_info: routeInfo
        };

        if (callback) {
            res.jsonp(responseData);
        } else {
            res.json(responseData);
        }

    } catch (error) {
        console.error('路线规划错误:', error);
        const errorResponse = {
            status: "0",
            info: error.message || "服务器错误",
            type: mode || "unknown",
            route_info: {}
        };

        if (callback) {
            res.jsonp(errorResponse);
        } else {
            res.json(errorResponse);
        }
    }
});

// 添加调试端点
app.get('/debug/route', async (req, res) => {
    try {
        const { origin, destination, mode, powerType } = req.query;
        const amapKey = process.env.AMAP_API_KEY;

        if (!origin || !destination || !mode) {
            return res.json({
                error: "Missing required parameters",
                params: { origin, destination, mode, powerType }
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
            url_called: url,
            power_type: powerType
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
