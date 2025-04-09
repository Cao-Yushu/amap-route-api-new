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

// 定义公交成本常量
const TRANSIT_COST_CONSTANTS = {
    BUS_FARE: 2.0,     // 深圳公交车单程票价（元）
    METRO_FARE: {      // 深圳地铁分段票价（元）
        BASE: 2,       // 基础票价
        STEP_1: 4,     // 4公里以上
        STEP_2: 6,     // 12公里以上
        STEP_3: 8,     // 24公里以上
        STEP_4: 10,    // 40公里以上
    }
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
                        text: `${Math.floor(path.duration / 60)}分${path.duration % 60}秒`
                    },
                    distance: {
                        value: parseInt(path.distance),
                        text: path.distance > 1000 ? `${(path.distance / 1000).toFixed(1)}公里` : `${path.distance}米`
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
                if (response.data.route && response.data.route.transits && response.data.route.transits.length > 0) {
                    const transit = response.data.route.transits[0];
                    
                    // 计算总距离和时间
                    const totalDistance = parseInt(transit.distance || 0);
                    const totalDuration = parseInt(transit.duration || 0);
                    
                    // 分析交通方式和计算成本
                    let totalCost = 0;
                    let transportModes = [];
                    let costDetails = [];
                    
                    if (transit.segments) {
                        transit.segments.forEach(segment => {
                            if (segment.bus && segment.bus.buslines && segment.bus.buslines.length > 0) {
                                const busline = segment.bus.buslines[0];
                                transportModes.push(`公交${busline.name}`);
                                totalCost += TRANSIT_COST_CONSTANTS.BUS_FARE;
                                costDetails.push(`公交${busline.name}: ${TRANSIT_COST_CONSTANTS.BUS_FARE}元`);
                            } else if (segment.railway) {
                                const railway = segment.railway;
                                transportModes.push(`地铁${railway.name}`);
                                // 根据距离计算地铁票价
                                const segmentDistance = parseInt(segment.distance || 0) / 1000;
                                let metroCost = TRANSIT_COST_CONSTANTS.METRO_FARE.BASE;
                                if (segmentDistance > 40) metroCost = TRANSIT_COST_CONSTANTS.METRO_FARE.STEP_4;
                                else if (segmentDistance > 24) metroCost = TRANSIT_COST_CONSTANTS.METRO_FARE.STEP_3;
                                else if (segmentDistance > 12) metroCost = TRANSIT_COST_CONSTANTS.METRO_FARE.STEP_2;
                                else if (segmentDistance > 4) metroCost = TRANSIT_COST_CONSTANTS.METRO_FARE.STEP_1;
                                totalCost += metroCost;
                                costDetails.push(`地铁${railway.name}: ${metroCost}元`);
                            }
                        });
                    }

                    result.route_info = {
                        duration: {
                            value: totalDuration,
                            text: `${Math.floor(totalDuration / 60)}分${totalDuration % 60}秒`
                        },
                        distance: {
                            value: totalDistance,
                            text: totalDistance > 1000 ? `${(totalDistance / 1000).toFixed(1)}公里` : `${totalDistance}米`
                        },
                        transport: {
                            modes: transportModes,
                            segments: transit.segments.length
                        },
                        cost: {
                            total: parseFloat(totalCost.toFixed(2)),
                            details: costDetails
                        }
                    };
                }
            }
            // TODO: 其他出行方式的数据处理将在后续添加
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
