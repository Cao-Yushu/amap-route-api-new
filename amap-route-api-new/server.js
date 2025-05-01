const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// CORS配置
const corsOptions = {
    origin: '*', // 允许所有来源访问
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: false,
    maxAge: 86400
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 添加中间件来设置响应头
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Content-Type', 'application/json; charset=utf-8');
    next();
});

// 添加请求日志中间件
app.use((req, res, next) => {
    console.log('收到请求:', {
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query,
        timestamp: new Date().toISOString()
    });
    next();
});

// 定义常量
const TRANSPORT_CONSTANTS = {
    CAR: {
        FUEL_PRICE: 7.79,         // 当前汽油价格（元/升）
        FUEL_CONSUMPTION: 8.0,    // 百公里油耗（升/100公里）
        DEPRECIATION_PER_KM: 0.5, // 每公里折旧成本（元/公里）
        CARBON_PER_KM: 171,       // 碳排放（克/公里）
        CALORIES_PER_KM: 0        // 卡路里消耗（千卡/公里）
    },
    TAXI: {
        CARBON_PER_KM: 171,       // 碳排放（克/公里）
        CALORIES_PER_KM: 0        // 卡路里消耗（千卡/公里）
    },
    TRANSIT: {
        CARBON_PER_KM: 30,        // 碳排放（克/公里）
        CALORIES_PER_KM: 20       // 卡路里消耗（千卡/公里，包含步行部分）
    },
    EBIKE: {
        COST_PER_KM: 0.1,         // 每公里成本（元/公里）
        CARBON_PER_KM: 5,         // 碳排放（克/公里）
        CALORIES_PER_KM: 20       // 卡路里消耗（千卡/公里）
    },
    BIKE: {
        CARBON_PER_KM: 0,         // 碳排放（克/公里）
        CALORIES_PER_KM: 40       // 卡路里消耗（千卡/公里）
    },
    WALK: {
        CARBON_PER_KM: 0,         // 碳排放（克/公里）
        CALORIES_PER_KM: 65       // 卡路里消耗（千卡/公里）
    }
};

// 健康检查端点
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Service is running',
        timestamp: new Date().toISOString()
    });
});

// 主路由处理
app.get('/api/route', async (req, res) => {
    const { origin, destination, mode, callback } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

    // 参数验证
    if (!origin || !destination || !mode || !amapKey) {
        const error = {
            status: "0",
            info: "缺少必要参数或API密钥未配置",
            type: mode || "unknown",
            route_info: {}
        };
        return sendResponse(res, error, callback);
    }

    try {
        let url;
        let response;
        let result = {
            status: "1",
            info: "OK",
            type: mode,
            route_info: {}
        };

        // 根据不同的出行方式构建URL和处理响应
        switch (mode) {
            case 'driving':
            case 'taxi':
                url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&extensions=all&key=${amapKey}`;
                response = await axios.get(url);
                
                if (response.data.status === '1' && response.data.route && response.data.route.paths && response.data.route.paths.length > 0) {
                    const path = response.data.route.paths[0];
                    const distance = parseFloat(path.distance) / 1000; // 转换为公里
                    const duration = Math.ceil(parseFloat(path.duration) / 60); // 转换为分钟
                    const taxi_cost = parseFloat(response.data.route.taxi_cost || 0);

                    if (mode === 'driving') {
                        const fuelCost = (distance * TRANSPORT_CONSTANTS.CAR.FUEL_CONSUMPTION / 100) * TRANSPORT_CONSTANTS.CAR.FUEL_PRICE;
                        const depreciationCost = distance * TRANSPORT_CONSTANTS.CAR.DEPRECIATION_PER_KM;
                        
                        // 计算三种TMC情景下的总成本
                        result.route_info = {
                            distance: distance.toFixed(2),
                            duration: duration,
                            cost_tmc1: (fuelCost + depreciationCost + distance * 1).toFixed(2),
                            cost_tmc2: (fuelCost + depreciationCost + distance * 2).toFixed(2),
                            cost_tmc3: (fuelCost + depreciationCost + distance * 3).toFixed(2),
                            carbon: Math.round(distance * TRANSPORT_CONSTANTS.CAR.CARBON_PER_KM),
                            calories: 0,
                            fuel_cost: fuelCost.toFixed(2),
                            depreciation_cost: depreciationCost.toFixed(2),
                            taxi_cost: taxi_cost.toFixed(2)
                        };
                    } else {
                        result.route_info = {
                            distance: distance.toFixed(2),
                            duration: duration,
                            cost_tmc1: (taxi_cost + distance * 1).toFixed(2),
                            cost_tmc2: (taxi_cost + distance * 2).toFixed(2),
                            cost_tmc3: (taxi_cost + distance * 3).toFixed(2),
                            carbon: Math.round(distance * TRANSPORT_CONSTANTS.TAXI.CARBON_PER_KM),
                            calories: 0
                        };
                    }
                }
                break;

            case 'transit':
                url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
                response = await axios.get(url);
                
                if (response.data.status === '1' && response.data.route && response.data.route.transits && response.data.route.transits.length > 0) {
                    const transit = response.data.route.transits[0];
                    const distance = parseFloat(transit.distance) / 1000;
                    const duration = Math.ceil(parseFloat(transit.duration) / 60);
                    const walking_distance = parseFloat(transit.walking_distance) / 1000;
                    
                    result.route_info = {
                        distance: distance.toFixed(2),
                        duration: duration,
                        cost: "2.00",
                        walking_distance: walking_distance.toFixed(2),
                        carbon: Math.round(distance * TRANSPORT_CONSTANTS.TRANSIT.CARBON_PER_KM),
                        calories: Math.round(walking_distance * TRANSPORT_CONSTANTS.WALK.CALORIES_PER_KM)
                    };
                }
                break;

            case 'ebike':
            case 'bicycling':
                url = `https://restapi.amap.com/v3/direction/riding?origin=${origin}&destination=${destination}&key=${amapKey}`;
                response = await axios.get(url);
                
                if (response.data.status === '1' && response.data.route && response.data.route.paths && response.data.route.paths.length > 0) {
                    const path = response.data.route.paths[0];
                    const distance = parseFloat(path.distance) / 1000;
                    const duration = Math.ceil(parseFloat(path.duration) / 60);
                    
                    if (mode === 'ebike') {
                        result.route_info = {
                            distance: distance.toFixed(2),
                            duration: duration,
                            cost: (distance * TRANSPORT_CONSTANTS.EBIKE.COST_PER_KM).toFixed(2),
                            carbon: Math.round(distance * TRANSPORT_CONSTANTS.EBIKE.CARBON_PER_KM),
                            calories: Math.round(distance * TRANSPORT_CONSTANTS.EBIKE.CALORIES_PER_KM)
                        };
                    } else {
                        result.route_info = {
                            distance: distance.toFixed(2),
                            duration: duration,
                            cost: "0.00",
                            carbon: 0,
                            calories: Math.round(distance * TRANSPORT_CONSTANTS.BIKE.CALORIES_PER_KM)
                        };
                    }
                }
                break;

            case 'walking':
                url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
                response = await axios.get(url);
                
                if (response.data.status === '1' && response.data.route && response.data.route.paths && response.data.route.paths.length > 0) {
                    const path = response.data.route.paths[0];
                    const distance = parseFloat(path.distance) / 1000;
                    const duration = Math.ceil(parseFloat(path.duration) / 60);
                    
                    result.route_info = {
                        distance: distance.toFixed(2),
                        duration: duration,
                        cost: "0.00",
                        carbon: 0,
                        calories: Math.round(distance * TRANSPORT_CONSTANTS.WALK.CALORIES_PER_KM)
                    };
                }
                break;

            default:
                throw new Error('不支持的交通方式');
        }

        // 记录成功响应
        console.log(`${mode}路线规划成功:`, result);
        
        return sendResponse(res, result, callback);

    } catch (error) {
        console.error('路线规划错误:', error);
        
        const errorResult = {
            status: "0",
            info: error.message || '服务器内部错误',
            type: mode,
            route_info: {}
        };
        
        return sendResponse(res, errorResult, callback);
    }
});

// 统一响应处理函数
function sendResponse(res, data, callback) {
    if (callback) {
        res.send(`${callback}(${JSON.stringify(data)})`);
    } else {
        res.json(data);
    }
}

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        status: "0",
        info: "服务器内部错误",
        error: err.message
    });
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器运行在端口 ${port}`);
    console.log('环境变量检查:');
    console.log('- AMAP_API_KEY:', process.env.AMAP_API_KEY ? '已设置' : '未设置');
    console.log('- PORT:', process.env.PORT || '使用默认值3000');
});
