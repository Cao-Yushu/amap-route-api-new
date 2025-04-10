const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// 配置CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

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

// 健康检查端点
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Service is running' });
});

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

    // 参数验证
    if (!origin || !destination || !mode) {
        return res.status(400).json({
            status: "0",
            info: "缺少必要参数",
            type: mode || "unknown",
            route_info: {}
        });
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
            return res.status(400).json({
                status: "0",
                info: "无效的出行方式",
                type: mode,
                route_info: {}
            });
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
                    
                    // 根据不同模式计算时间和成本
                    const originalDuration = parseInt(path.duration);
                    const duration = mode === 'ebike' 
                        ? Math.floor(originalDuration / EBIKE_CONSTANTS.SPEED_MULTIPLIER)
                        : originalDuration;

                    let costDetail;
                    let totalCost = 0;
                    let calories = 0;

                    if (mode === 'ebike') {
                        totalCost = parseFloat((distanceInKm * EBIKE_CONSTANTS.COST_PER_KM).toFixed(2));
                        costDetail = `电费和损耗: ${totalCost}元`;
                    } else {
                        calories = parseFloat((distanceInKm * 40).toFixed(2));
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
                            total: totalCost,
                            cost_detail: costDetail
                        }
                    };

                    if (path.steps) {
                        result.route_info.steps = path.steps.map(step => ({
                            instruction: step.instruction || '',
                            orientation: step.orientation || '',
                            road_name: step.road || '',
                            distance: {
                                value: parseInt(step.distance),
                                text: `${(parseInt(step.distance) / 1000).toFixed(2)}公里`
                            },
                            duration: {
                                value: mode === 'ebike' ? Math.floor(parseInt(step.duration) / EBIKE_CONSTANTS.SPEED_MULTIPLIER) : parseInt(step.duration),
                                text: `${Math.floor(parseInt(step.duration) / 60)}分钟`
                            }
                        }));
                    }
                }
            } else if (mode === 'driving') {
                const path = response.data.route.paths[0];
                const distanceInKm = parseInt(path.distance) / 1000;
                const fuelCost = (distanceInKm * DRIVING_COST_CONSTANTS.FUEL_CONSUMPTION * DRIVING_COST_CONSTANTS.FUEL_PRICE) / 100;
                const depreciationCost = distanceInKm * DRIVING_COST_CONSTANTS.DEPRECIATION_PER_KM;
                const tollCost = path.tolls ? parseFloat(path.tolls) : 0;
                const totalCost = fuelCost + depreciationCost + tollCost;

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
                        cost_detail: `油费: ${fuelCost.toFixed(2)}元, 折旧: ${depreciationCost.toFixed(2)}元${tollCost > 0 ? `, 过路费: ${tollCost}元` : ''}`
                    },
                    steps: path.steps.map(step => ({
                        instruction: step.instruction,
                        road_name: step.road_name || '',
                        distance: {
                            value: parseInt(step.distance),
                            text: `${(parseInt(step.distance) / 1000).toFixed(2)}公里`
                        },
                        duration: {
                            value: parseInt(step.duration),
                            text: `${Math.floor(parseInt(step.duration) / 60)}分钟`
                        }
                    }))
                };
            } else if (mode === 'transit') {
                if (response.data.route && response.data.route.transits && response.data.route.transits.length > 0) {
                    const transit = response.data.route.transits[0];
                    result.route_info = {
                        duration: {
                            value: parseInt(transit.duration),
                            text: `${Math.floor(transit.duration / 60)}分钟`
                        },
                        distance: {
                            value: parseInt(transit.distance),
                            text: `${(parseInt(transit.distance) / 1000).toFixed(2)}公里`
                        },
                        cost: {
                            total: parseFloat(transit.cost),
                            walking_distance: parseInt(transit.walking_distance),
                            cost_detail: `票价: ${transit.cost}元, 步行距离: ${(transit.walking_distance / 1000).toFixed(2)}公里`
                        },
                        segments: transit.segments.map(segment => {
                            let segmentInfo = {
                                instruction: '',
                                distance: {
                                    value: 0,
                                    text: ''
                                },
                                duration: {
                                    value: 0,
                                    text: ''
                                }
                            };

                            if (segment.walking) {
                                segmentInfo = {
                                    type: 'walking',
                                    instruction: `步行${(segment.walking.distance / 1000).toFixed(2)}公里`,
                                    distance: {
                                        value: segment.walking.distance,
                                        text: `${(segment.walking.distance / 1000).toFixed(2)}公里`
                                    },
                                    duration: {
                                        value: segment.walking.duration,
                                        text: `${Math.floor(segment.walking.duration / 60)}分钟`
                                    }
                                };
                            } else if (segment.bus) {
                                segmentInfo = {
                                    type: 'bus',
                                    instruction: `乘坐${segment.bus.buslines[0].name}`,
                                    distance: {
                                        value: segment.bus.buslines[0].distance,
                                        text: `${(segment.bus.buslines[0].distance / 1000).toFixed(2)}公里`
                                    },
                                    duration: {
                                        value: segment.bus.buslines[0].duration,
                                        text: `${Math.floor(segment.bus.buslines[0].duration / 60)}分钟`
                                    },
                                    start_stop: segment.bus.buslines[0].departure_stop.name,
                                    end_stop: segment.bus.buslines[0].arrival_stop.name,
                                    cost: segment.bus.buslines[0].total_price || 0
                                };
                            }

                            return segmentInfo;
                        })
                    };
                }
            } else if (mode === 'walking') {
                const path = response.data.route.paths[0];
                const distanceInKm = parseInt(path.distance) / 1000;
                
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
                        calorie: parseFloat((distanceInKm * 65).toFixed(2)),
                        total: 0,
                        cost_detail: `消耗卡路里: ${(distanceInKm * 65).toFixed(2)}卡`
                    },
                    steps: path.steps.map(step => ({
                        instruction: step.instruction,
                        road_name: step.road || '',
                        distance: {
                            value: parseInt(step.distance),
                            text: `${(parseInt(step.distance) / 1000).toFixed(2)}公里`
                        },
                        duration: {
                            value: parseInt(step.duration),
                            text: `${Math.floor(parseInt(step.duration) / 60)}分钟`
                        }
                    }))
                };
            }
        }

        res.json(result);
    } catch (error) {
        console.error("请求错误:", error);
        res.status(500).json({
            status: "0",
            info: error.message || "请求失败",
            type: mode,
            route_info: {}
        });
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: "0",
        info: "服务器内部错误",
        error: err.message
    });
});

app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});
