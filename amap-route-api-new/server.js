const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// 定义私家车成本常量
const DRIVING_COST_CONSTANTS = {
    FUEL_PRICE: 7.79,  // 假设当前汽油价格（元/升）
    FUEL_CONSUMPTION: 8.0,  // 假设百公里油耗（升/100公里）
    DEPRECIATION_PER_KM: 0.5,  // 假设每公里折旧成本（元/公里）
};

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

    // 根据不同的出行方式构建 URL
    let url;
    if (mode === 'transit') {
        // 深圳市的城市编码是0755
        url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
    } else if (mode === 'driving') {
        url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'walking') {
        url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'bicycling') {
        url = `https://restapi.amap.com/v4/direction/bicycling?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else {
        return res.status(400).json({ status: "0", info: "无效的出行方式" });
    }

    try {
        const response = await axios.get(url);
        
        // 处理API响应数据
        const result = {
            status: response.data.status,
            info: response.data.info,
            type: mode,
            route_info: {}
        };

        if (response.data.status === '1') {
            if (mode === 'driving') {
                const path = response.data.route.paths[0];
                const distanceInKm = parseInt(path.distance) / 1000;
                
                // 计算行驶成本
                const fuelCost = (distanceInKm * DRIVING_COST_CONSTANTS.FUEL_CONSUMPTION * DRIVING_COST_CONSTANTS.FUEL_PRICE) / 100;
                const depreciationCost = distanceInKm * DRIVING_COST_CONSTANTS.DEPRECIATION_PER_KM;
                const tollCost = parseFloat(path.tolls || 0);
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
                        cost_detail: `油费: ${fuelCost.toFixed(2)}元, 折旧: ${depreciationCost.toFixed(2)}元, 过路费: ${tollCost}元`
                    }
                };
            } else if (mode === 'transit') {
                // 获取第一个公交方案
                const transitData = response.data.route;
                const firstTransit = transitData.transits[0];
                const distanceInKm = parseInt(firstTransit.distance) / 1000;

                result.route_info = {
                    duration: {
                        value: parseInt(firstTransit.duration),
                        text: `${Math.floor(firstTransit.duration / 60)}分钟`
                    },
                    distance: {
                        value: parseInt(firstTransit.distance),
                        text: `${distanceInKm.toFixed(2)}公里`
                    },
                    cost: {
                        ticket: parseFloat(firstTransit.cost),
                        walking_distance: parseFloat((firstTransit.walking_distance / 1000).toFixed(2)),
                        taxi_cost: parseFloat(transitData.taxi_cost),
                        total: parseFloat(firstTransit.cost),
                        cost_detail: `票价: ${firstTransit.cost}元, 步行距离: ${(firstTransit.walking_distance / 1000).toFixed(2)}公里, 打车参考: ${transitData.taxi_cost}元`
                    },
                    segments: firstTransit.segments.map(segment => ({
                        type: segment.bus ? 'bus' : 'walking',
                        distance: segment.bus ? 
                            parseInt(segment.bus.buslines[0].distance) : 
                            parseInt(segment.walking.distance),
                        duration: segment.bus ? 
                            parseInt(segment.bus.buslines[0].duration) : 
                            parseInt(segment.walking.duration),
                        detail: segment.bus ? {
                            line: segment.bus.buslines[0].name,
                            departure: segment.bus.buslines[0].departure_stop.name,
                            arrival: segment.bus.buslines[0].arrival_stop.name,
                            via_stops: segment.bus.buslines[0].via_stops.length
                        } : {
                            steps: segment.walking.steps.map(step => step.instruction)
                        }
                    }))
                };
            } else if (mode === 'walking') {
                // 处理步行路线数据
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
                        calorie: parseFloat((distanceInKm * 65).toFixed(2)), // 假设每公里消耗65卡路里
                        total: 0,
                        cost_detail: `消耗卡路里: ${(distanceInKm * 65).toFixed(2)}卡`
                    },
                    steps: path.steps.map(step => ({
                        instruction: step.instruction,
                        road: step.road || '',
                        distance: {
                            value: parseInt(step.distance),
                            text: `${(parseInt(step.distance) / 1000).toFixed(2)}公里`
                        },
                        duration: {
                            value: parseInt(step.duration || 0),
                            text: `${Math.floor((parseInt(step.duration || 0)) / 60)}分钟`
                        }
                    }))
                };
            } else if (mode === 'bicycling') {
                // 处理骑行路线数据
                const path = response.data.data.paths[0]; // 注意骑行API的返回结构略有不同
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
                        calorie: parseFloat((distanceInKm * 40).toFixed(2)), // 假设每公里消耗40卡路里
                        total: 0,
                        cost_detail: `消耗卡路里: ${(distanceInKm * 40).toFixed(2)}卡`
                    },
                    steps: path.steps.map(step => ({
                        instruction: step.instruction,
                        road: step.road_name || '',
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
        res.status(500).json({ status: "0", info: "请求失败" });
    }
});

app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});
