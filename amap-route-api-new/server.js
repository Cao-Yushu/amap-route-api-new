const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// CORS配置
const corsOptions = {
    origin: ['https://hku.au1.qualtrics.com', 'https://au1.qualtrics.com'],
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: false,
    maxAge: 86400 // 预检请求的结果可以缓存24小时
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 添加中间件来设置响应头
app.use((req, res, next) => {
    // 允许JSONP请求
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Content-Type', 'application/javascript; charset=utf-8');
    next();
});

// 添加请求日志中间件
app.use((req, res, next) => {
    console.log('收到请求:', {
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query
    });
    next();
});

// 定义私家车成本常量
const DRIVING_COST_CONSTANTS = {
    FUEL_PRICE: 7.79,  // 当前汽油价格（元/升）
    FUEL_CONSUMPTION: 8.0,  // 百公里油耗（升/100公里）
    DEPRECIATION_PER_KM: 0.5,  // 每公里折旧成本（元/公里）
};

// 定义电动自行车常量
const EBIKE_CONSTANTS = {
    SPEED_MULTIPLIER: 1.5,  // 相对于普通自行车的速度倍数
    COST_PER_KM: 0.1,      // 每公里成本（元/公里）
    CALORIE_PER_KM: 0      // 电动自行车不计算卡路里消耗
};

// 碳排放常量（g/km）
const CARBON_CONSTANTS = {
    DRIVING: 180,   // g/km
    TAXI: 180,      // g/km
    TRANSIT: 30,    // g/km
    WALKING: 0,     // g/km
    BICYCLING: 0,   // g/km
    EBIKE: 0        // g/km
};

// 卡路里常量（kcal/km）
const CALORIE_CONSTANTS = {
    WALKING: 65,    // kcal/km
    BICYCLING: 40,  // kcal/km
    EBIKE: 0        // kcal/km
};

// 健康检查端点
app.get('/', (req, res) => {
    const { callback } = req.query;
    const response = { status: 'ok', message: 'Service is running' };
    
    if (callback) {
        res.send(`${callback}(${JSON.stringify(response)})`);
    } else {
        res.json(response);
    }
});

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode, callback } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

    // 参数验证
    if (!origin || !destination || !mode) {
        const error = {
            status: "0",
            info: "缺少必要参数",
            type: mode || "unknown",
            route_info: {}
        };
        return callback ? 
            res.send(`${callback}(${JSON.stringify(error)})`) : 
            res.json(error);
    }

    try {
        let url;
        // 根据不同的出行方式构建 URL
        if (mode === 'ebike' || mode === 'bicycling') {
            url = `https://restapi.amap.com/v3/direction/riding?origin=${origin}&destination=${destination}&key=${amapKey}`;
        } else if (mode === 'transit') {
            url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
        } else if (mode === 'driving') {
            url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&extensions=all&key=${amapKey}`;
        } else if (mode === 'walking') {
            url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
        } else {
            const error = {
                status: "0",
                info: "无效的出行方式",
                type: mode,
                route_info: {}
            };
            return callback ? 
                res.send(`${callback}(${JSON.stringify(error)})`) : 
                res.json(error);
        }

        console.log('请求高德API:', url);
        const response = await axios.get(url);
        console.log('高德API响应:', JSON.stringify(response.data, null, 2));

        const result = {
            status: response.data.status,
            info: response.data.info,
            type: mode,
            route_info: {}
        };

        if (response.data.status === '1') {
            if (mode === 'bicycling' || mode === 'ebike') {
                const paths = response.data.route.paths;
                if (paths && paths.length > 0) {
                    const path = paths[0];
                    const distanceInKm = parseInt(path.distance) / 1000;

                    const originalDuration = parseInt(path.duration);
                    const duration = mode === 'ebike' 
                        ? Math.floor(originalDuration / EBIKE_CONSTANTS.SPEED_MULTIPLIER)
                        : originalDuration;

                    let costDetail;
                    let totalCost = 0;
                    let calories = 0;
                    let carbon = 0;

                    if (mode === 'ebike') {
                        totalCost = parseFloat((distanceInKm * EBIKE_CONSTANTS.COST_PER_KM).toFixed(2));
                        calories = 0;
                        carbon = 0;
                        costDetail = `电费和损耗: ${totalCost}元`;
                    } else {
                        calories = parseFloat((distanceInKm * CALORIE_CONSTANTS.BICYCLING).toFixed(2));
                        carbon = 0;
                        costDetail = `消耗卡路里: ${calories}卡`;
                    }

                    result.route_info = {
                        duration: {
                            value: duration,
                            text: `${Math.floor(duration / 60)}分钟`
                        },
                        distance: {
                            value: parseInt(path.distance),
                            text: `${distanceInKm.toFixed(2)}公里`
                        },
                        cost: {
                            calorie: calories,
                            carbon: carbon,
                            total: totalCost,
                            cost_detail: costDetail
                        }
                    };
                }
            } else if (mode === 'driving') {
                const path = response.data.route.paths[0];
                const distanceInKm = parseInt(path.distance) / 1000;
                const fuelCost = (distanceInKm * DRIVING_COST_CONSTANTS.FUEL_CONSUMPTION * DRIVING_COST_CONSTANTS.FUEL_PRICE) / 100;
                const depreciationCost = distanceInKm * DRIVING_COST_CONSTANTS.DEPRECIATION_PER_KM;
                const tollCost = path.tolls ? parseFloat(path.tolls) : 0;
                const totalCost = fuelCost + depreciationCost + tollCost;

                // 网约车价格
                const taxiCost = response.data.route.taxi_cost ? parseFloat(response.data.route.taxi_cost) : null;

                // TMC三种情景
                const tmcRates = [1, 2, 3]; // 元/公里
                const tmcResults = tmcRates.map(rate => {
                    const tmcCost = distanceInKm * rate;
                    return {
                        tmc_rate: rate,
                        driving_total: parseFloat((totalCost + tmcCost).toFixed(2)),
                        taxi_total: taxiCost !== null ? parseFloat((taxiCost + tmcCost).toFixed(2)) : null,
                        tmc_cost: parseFloat(tmcCost.toFixed(2))
                    };
                });

                // 驾车/网约车卡路里和碳排放
                const drivingCalorie = 0;
                const drivingCarbon = parseFloat((distanceInKm * CARBON_CONSTANTS.DRIVING).toFixed(2));
                const taxiCalorie = 0;
                const taxiCarbon = parseFloat((distanceInKm * CARBON_CONSTANTS.TAXI).toFixed(2));

                result.route_info = {
                    duration: {
                        value: parseInt(path.duration),
                        text: `${Math.floor(path.duration / 60)}分钟`
                    },
                    distance: {
                        value: parseInt(path.distance),
                        text: `${distanceInKm.toFixed(2)}公里`
                    },
                    cost: {
                        fuel: parseFloat(fuelCost.toFixed(2)),
                        depreciation: parseFloat(depreciationCost.toFixed(2)),
                        toll: tollCost,
                        total: parseFloat(totalCost.toFixed(2)),
                        taxi_cost: taxiCost,
                        tmc_scenarios: tmcResults,
                        calorie: drivingCalorie,
                        carbon: drivingCarbon,
                        taxi_calorie: taxiCalorie,
                        taxi_carbon: taxiCarbon,
                        cost_detail: `油费: ${fuelCost.toFixed(2)}元, 折旧: ${depreciationCost.toFixed(2)}元${tollCost > 0 ? `, 过路费: ${tollCost}元` : ''}${taxiCost !== null ? `, 网约车: ${taxiCost}元` : ''}`
                    }
                };
            } else if (mode === 'transit') {
                if (response.data.route && response.data.route.transits && response.data.route.transits.length > 0) {
                    const transit = response.data.route.transits[0];
                    const distanceInKm = parseInt(transit.distance) / 1000;
                    const calorie = 0;
                    const carbon = parseFloat((distanceInKm * CARBON_CONSTANTS.TRANSIT).toFixed(2));
                    result.route_info = {
                        duration: {
                            value: parseInt(transit.duration),
                            text: `${Math.floor(transit.duration / 60)}分钟`
                        },
                        distance: {
                            value: parseInt(transit.distance),
                            text: `${distanceInKm.toFixed(2)}公里`
                        },
                        cost: {
                            total: parseFloat(transit.cost),
                            walking_distance: parseInt(transit.walking_distance),
                            calorie: calorie,
                            carbon: carbon,
                            cost_detail: `票价: ${transit.cost}元, 步行距离: ${(transit.walking_distance / 1000).toFixed(2)}公里`
                        }
                    };
                }
            } else if (mode === 'walking') {
                const path = response.data.route.paths[0];
                const distanceInKm = parseInt(path.distance) / 1000;
                const calorie = parseFloat((distanceInKm * CALORIE_CONSTANTS.WALKING).toFixed(2));
                const carbon = 0;
                result.route_info = {
                    duration: {
                        value: parseInt(path.duration),
                        text: `${Math.floor(path.duration / 60)}分钟`
                    },
                    distance: {
                        value: parseInt(path.distance),
                        text: `${distanceInKm.toFixed(2)}公里`
                    },
                    cost: {
                        calorie: calorie,
                        carbon: carbon,
                        total: 0,
                        cost_detail: `消耗卡路里: ${calorie}卡`
                    }
                };
            }
        }

        // 根据请求类型返回相应格式的响应
        if (callback) {
            res.send(`${callback}(${JSON.stringify(result)})`);
        } else {
            res.json(result);
        }
    } catch (error) {
        console.error("请求错误:", error);
        const errorResponse = {
            status: "0",
            info: error.message || "请求失败",
            type: mode,
            route_info: {}
        };
        
        if (callback) {
            res.send(`${callback}(${JSON.stringify(errorResponse)})`);
        } else {
            res.status(500).json(errorResponse);
        }
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error("服务器错误:", err);
    const errorResponse = {
        status: "0",
        info: "服务器内部错误",
        error: err.message,
        type: req.query.mode || "unknown",
        route_info: {}
    };

    const { callback } = req.query;
    if (callback) {
        res.send(`${callback}(${JSON.stringify(errorResponse)})`);
    } else {
        res.status(500).json(errorResponse);
    }
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
    console.log('环境变量:', {
        NODE_ENV: process.env.NODE_ENV,
        AMAP_API_KEY: process.env.AMAP_API_KEY ? '已设置' : '未设置'
    });
});
