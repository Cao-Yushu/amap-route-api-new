const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// 允许跨域请求
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// 定义私家车成本常量
const DRIVING_COST_CONSTANTS = {
    FUEL_PRICE: 7.79,  // 当前汽油价格（元/升）
    FUEL_CONSUMPTION: 8.0,  // 百公里油耗（升/100公里）
    DEPRECIATION_PER_KM: 0.5,  // 每公里折旧成本（元/公里）
};

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

    if (!origin || !destination || !mode) {
        return res.status(400).json({
            status: "0",
            info: "缺少必要参数",
            type: mode || "unknown",
            route_info: {}
        });
    }

    // 根据不同的出行方式构建 URL
    let url;
    if (mode === 'transit') {
        url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
    } else if (mode === 'driving') {
        url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&extensions=all&key=${amapKey}`;
    } else if (mode === 'walking') {
        url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'bicycling') {
        // 使用v4版本的骑行API
        url = `https://restapi.amap.com/v4/direction/bicycling?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else {
        return res.status(400).json({
            status: "0",
            info: "无效的出行方式",
            type: mode,
            route_info: {}
        });
    }

    try {
        const response = await axios.get(url);
        console.log('API Response:', JSON.stringify(response.data, null, 2)); // 添加日志

        const result = {
            status: mode === 'bicycling' ? response.data.errcode : response.data.status,
            info: mode === 'bicycling' ? response.data.errmsg : response.data.info,
            type: mode,
            route_info: {}
        };

        if (mode === 'bicycling') {
            if (response.data.errcode === 0 && response.data.data) {
                const pathData = response.data.data;
                const distanceInKm = parseInt(pathData.distance) / 1000;
                
                result.route_info = {
                    duration: {
                        value: parseInt(pathData.duration),
                        text: `${Math.floor(pathData.duration / 60)}分钟`
                    },
                    distance: {
                        value: parseInt(pathData.distance),
                        text: `${distanceInKm.toFixed(2)}公里`
                    },
                    cost: {
                        calorie: parseFloat((distanceInKm * 40).toFixed(2)),
                        total: 0,
                        cost_detail: `消耗卡路里: ${(distanceInKm * 40).toFixed(2)}卡`
                    }
                };

                if (pathData.paths && pathData.paths.length > 0) {
                    result.route_info.steps = pathData.paths[0].steps.map(step => ({
                        instruction: step.instruction,
                        orientation: step.orientation || '',
                        road_name: step.road || '',
                        distance: {
                            value: parseInt(step.distance),
                            text: `${(parseInt(step.distance) / 1000).toFixed(2)}公里`
                        },
                        duration: {
                            value: parseInt(step.duration || 0),
                            text: `${Math.floor(parseInt(step.duration || 0) / 60)}分钟`
                        }
                    }));
                }
            }
        } else if (mode === 'driving') {
            // 驾车路线处理逻辑保持不变
            if (response.data.status === '1' && response.data.route.paths && response.data.route.paths.length > 0) {
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
            }
        } else if (mode === 'walking') {
            // 步行路线处理逻辑保持不变
            if (response.data.status === '1' && response.data.route.paths && response.data.route.paths.length > 0) {
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
        } else if (mode === 'transit') {
            // 公交路线处理逻辑保持不变
            if (response.data.status === '1' && response.data.route.transits && response.data.route.transits.length > 0) {
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

app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});
