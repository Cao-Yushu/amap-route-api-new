try {
    const response = await axios.get(url);
    const data = response.data;

    // 检查 API 返回状态
    if (data.status === '0') {
        return res.status(400).json({ status: "0", info: data.info });
    }

    // 处理返回数据
    let distance = 0;
    let duration = 0;
    let cost = 0;

    if (mode === 'driving') {
        if (data.route && data.route.paths.length > 0) {
            distance = parseFloat(data.route.paths[0].distance) || 0;
            duration = parseFloat(data.route.paths[0].duration) || 0;
            cost = (distance / 1000) * fuelCostPerKm + (parseFloat(data.route.tolls) || 0);
        }
    } else if (mode === 'transit') {
        if (data.route && data.route.transits.length > 0) {
            distance = parseFloat(data.route.transits[0].distance) || 0;
            duration = parseFloat(data.route.transits[0].duration) || 0;
            cost = parseFloat(data.route.transit_fee) || 0;
        }
    } else if (mode === 'walking' || mode === 'bicycling') {
        if (data.route && data.route.paths.length > 0) {
            distance = parseFloat(data.route.paths[0].distance) || 0;
            duration = parseFloat(data.route.paths[0].duration) || 0;
        }
    }

    // 转换单位
    const distanceInKm = (distance / 1000).toFixed(2);
    const durationInMinutes = (duration / 60).toFixed(2);

    res.json({
        duration: durationInMinutes,
        distance: distanceInKm,
        cost: cost
    });
} catch (error) {
    console.error("请求错误:", error);
    res.status(500).json({ status: "0", info: "请求失败" });
}
