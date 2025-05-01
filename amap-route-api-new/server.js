const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// 更新CORS配置
const corsOptions = {
    origin: '*', // 允许所有域名访问
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
    next();
});

// 路由处理
app.get('/', (req, res) => {
    const { callback } = req.query;
    const response = { status: 'ok', message: 'Service is running' };
    
    if (callback) {
        res.jsonp(response);
    } else {
        res.json(response);
    }
});

app.get('/api/route', async (req, res) => {
    try {
        const { origin, destination, mode, callback } = req.query;
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

        let url;
        switch (mode) {
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
                const distance = parseFloat(path.distance) / 1000; // 转换为公里
                const duration = Math.ceil(path.duration / 60); // 转换为分钟
                const fuelCost = (distance * 7.79 * 8.0) / 100; // 油费计算
                const depreciationCost = distance * 0.5; // 折旧成本
                const taxiCost = parseFloat(result.route.taxi_cost || "0");
                
                // 计算不同TMC情况下的成本
                const tmcCost1 = distance * 1 + fuelCost + depreciationCost;
                const tmcCost2 = distance * 2 + fuelCost + depreciationCost;
                const tmcCost3 = distance * 3 + fuelCost + depreciationCost;

                routeInfo = {
                    distance: distance.toFixed(2),
                    duration,
                    cost_tmc1: tmcCost1.toFixed(2),
                    cost_tmc2: tmcCost2.toFixed(2),
                    cost_tmc3: tmcCost3.toFixed(2),
                    carbon: Math.round(distance * 171), // 碳排放：171g/km
                    calories: 0,
                    fuel_cost: fuelCost.toFixed(2),
                    depreciation_cost: depreciationCost.toFixed(2),
                    taxi_cost: taxiCost.toFixed(2)
                };
                break;

            case 'transit':
                const transitPath = result.route.transits[0];
                const transitDistance = parseFloat(transitPath.distance) / 1000;
                const transitDuration = Math.ceil(transitPath.duration / 60);
                const walkingDistance = (transitPath.walking_distance || 0) / 1000;
                
                routeInfo = {
                    distance: transitDistance.toFixed(2),
                    duration: transitDuration,
                    cost: transitPath.cost || "2.00",
                    walking_distance: walkingDistance.toFixed(2),
                    carbon: Math.round(transitDistance * 30), // 碳排放：30g/km
                    calories: Math.round(walkingDistance * 65) // 步行消耗：65kcal/km
                };
                break;

            case 'walking':
                const walkPath = result.route.paths[0];
                const walkDistance = parseFloat(walkPath.distance) / 1000;
                const walkDuration = Math.ceil(walkPath.duration / 60);
                
                routeInfo = {
                    distance: walkDistance.toFixed(2),
                    duration: walkDuration,
                    cost: "0.00",
                    carbon: 0,
                    calories: Math.round(walkDistance * 65) // 步行消耗：65kcal/km
                };
                break;

            case 'bicycling':
                const bikePath = result.route.paths[0];
                const bikeDistance = parseFloat(bikePath.distance) / 1000;
                const bikeDuration = Math.ceil(bikePath.duration / 60);
                
                routeInfo = {
                    distance: bikeDistance.toFixed(2),
                    duration: bikeDuration,
                    cost: "0.00",
                    carbon: 0,
                    calories: Math.round(bikeDistance * 40) // 自行车消耗：40kcal/km
                };
                break;

            case 'ebike':
                const ebikePath = result.route.paths[0];
                const ebikeDistance = parseFloat(ebikePath.distance) / 1000;
                const ebikeDuration = Math.ceil(ebikePath.duration / 60 / 1.5); // 电动自行车速度是普通自行车的1.5倍
                
                routeInfo = {
                    distance: ebikeDistance.toFixed(2),
                    duration: ebikeDuration,
                    cost: (ebikeDistance * 0.1).toFixed(2), // 电动自行车成本：0.1元/km
                    carbon: Math.round(ebikeDistance * 12), // 碳排放：12g/km
                    calories: 0
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
            type: mode,
            route_info: {}
        };

        if (callback) {
            res.jsonp(errorResponse);
        } else {
            res.json(errorResponse);
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
