function sleep_thread_async(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

this.onmessage = function(event) {
	
	var endlessLoop = async (periodMS) => {
		postMessage('simulation heartbeat loop started');
		while (true) {
			await this.sleep_thread_async(periodMS)
			postMessage(periodMS);
		}
	};
	
	endlessLoop(event.data)
	.then(() => { console.log('simulation heartbeat loop terminated')})
};

