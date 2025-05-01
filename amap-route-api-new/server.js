// 定义各种交通方式的碳排放和卡路里消耗常量
const TRANSPORT_CONSTANTS = {
    CAR: {
        CARBON_PER_KM: 171,    // g/km
        CALORIES_PER_KM: 0     // kcal/km
    },
    TAXI: {
        CARBON_PER_KM: 171,    // g/km
        CALORIES_PER_KM: 0     // kcal/km
    },
    TRANSIT: {
        CARBON_PER_KM: 30,     // g/km
        CALORIES_PER_KM: 20    // kcal/km (包含步行部分)
    },
    EBIKE: {
        CARBON_PER_KM: 5,      // g/km
        CALORIES_PER_KM: 20    // kcal/km
    },
    BIKE: {
        CARBON_PER_KM: 0,      // g/km
        CALORIES_PER_KM: 40    // kcal/km
    },
    WALK: {
        CARBON_PER_KM: 0,      // g/km
        CALORIES_PER_KM: 65    // kcal/km
    }
};

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode, callback } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

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
        if (mode === 'driving' || mode === 'taxi') {
            url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&extensions=all&key=${amapKey}`;
            response = await axios.get(url);
            
            if (response.data.status === '1' && response.data.route && response.data.route.paths && response.data.route.paths.length > 0) {
                const path = response.data.route.paths[0];
                const distance = parseFloat(path.distance) / 1000; // 转换为公里
                const duration = Math.ceil(parseFloat(path.duration) / 60); // 转换为分钟
                const taxi_cost = parseFloat(response.data.route.taxi_cost || 0);

                // 计算驾车成本
                if (mode === 'driving') {
                    const fuelCost = (distance * DRIVING_COST_CONSTANTS.FUEL_CONSUMPTION / 100) * DRIVING_COST_CONSTANTS.FUEL_PRICE;
                    const depreciationCost = distance * DRIVING_COST_CONSTANTS.DEPRECIATION_PER_KM;
                    
                    // 计算三种TMC情景下的总成本
                    const tmcCost1 = distance * 1;
                    const tmcCost2 = distance * 2;
                    const tmcCost3 = distance * 3;

                    result.route_info = {
                        distance: distance,
                        duration: duration,
                        cost_tmc1: (fuelCost + depreciationCost + tmcCost1).toFixed(2),
                        cost_tmc2: (fuelCost + depreciationCost + tmcCost2).toFixed(2),
                        cost_tmc3: (fuelCost + depreciationCost + tmcCost3).toFixed(2),
                        carbon: Math.round(distance * TRANSPORT_CONSTANTS.CAR.CARBON_PER_KM),
                        calories: 0
                    };
                } else { // 网约车
                    // 计算三种TMC情景下的网约车总成本
                    const tmcCost1 = distance * 1;
                    const tmcCost2 = distance * 2;
                    const tmcCost3 = distance * 3;

                    result.route_info = {
                        distance: distance,
                        duration: duration,
                        cost_tmc1: (taxi_cost + tmcCost1).toFixed(2),
                        cost_tmc2: (taxi_cost + tmcCost2).toFixed(2),
                        cost_tmc3: (taxi_cost + tmcCost3).toFixed(2),
                        carbon: Math.round(distance * TRANSPORT_CONSTANTS.TAXI.CARBON_PER_KM),
                        calories: 0
                    };
                }
            }
        } else if (mode === 'transit') {
            url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
            response = await axios.get(url);
            
            if (response.data.status === '1' && response.data.route && response.data.route.transits && response.data.route.transits.length > 0) {
                const transit = response.data.route.transits[0];
                const distance = parseFloat(transit.distance) / 1000;
                const duration = Math.ceil(parseFloat(transit.duration) / 60);
                const walking_distance = parseFloat(transit.walking_distance) / 1000;
                
                result.route_info = {
                    distance: distance,
                    duration: duration,
                    cost: "2.00",
                    walking_distance: walking_distance.toFixed(2),
                    carbon: Math.round(distance * TRANSPORT_CONSTANTS.TRANSIT.CARBON_PER_KM),
                    calories: Math.round(walking_distance * TRANSPORT_CONSTANTS.WALK.CALORIES_PER_KM)
                };
            }
        } else if (mode === 'ebike' || mode === 'bicycling') {
            url = `https://restapi.amap.com/v3/direction/riding?origin=${origin}&destination=${destination}&key=${amapKey}`;
            response = await axios.get(url);
            
            if (response.data.status === '1' && response.data.route && response.data.route.paths && response.data.route.paths.length > 0) {
                const path = response.data.route.paths[0];
                const distance = parseFloat(path.distance) / 1000;
                const duration = Math.ceil(parseFloat(path.duration) / 60);
                
                if (mode === 'ebike') {
                    result.route_info = {
                        distance: distance,
                        duration: duration,
                        cost: (distance * EBIKE_CONSTANTS.COST_PER_KM).toFixed(2),
                        carbon: Math.round(distance * TRANSPORT_CONSTANTS.EBIKE.CARBON_PER_KM),
                        calories: Math.round(distance * TRANSPORT_CONSTANTS.EBIKE.CALORIES_PER_KM)
                    };
                } else {
                    result.route_info = {
                        distance: distance,
                        duration: duration,
                        cost: "0.00",
                        carbon: 0,
                        calories: Math.round(distance * TRANSPORT_CONSTANTS.BIKE.CALORIES_PER_KM)
                    };
                }
            }
        } else if (mode === 'walking') {
            url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
            response = await axios.get(url);
            
            if (response.data.status === '1' && response.data.route && response.data.route.paths && response.data.route.paths.length > 0) {
                const path = response.data.route.paths[0];
                const distance = parseFloat(path.distance) / 1000;
                const duration = Math.ceil(parseFloat(path.duration) / 60);
                
                result.route_info = {
                    distance: distance,
                    duration: duration,
                    cost: "0.00",
                    carbon: 0,
                    calories: Math.round(distance * TRANSPORT_CONSTANTS.WALK.CALORIES_PER_KM)
                };
            }
        }

        if (callback) {
            res.send(`${callback}(${JSON.stringify(result)})`);
        } else {
            res.json(result);
        }
    } catch (error) {
        console.error('Error:', error);
        const errorResult = {
            status: "0",
            info: error.message,
            type: mode,
            route_info: {}
        };
        
        if (callback) {
            res.send(`${callback}(${JSON.stringify(errorResult)})`);
        } else {
            res.json(errorResult);
        }
    }
});
