this.onmessage = function(event) {
	
	var endlessLoop = function(periodMS) {
		postMessage('starting loop');
		while (true) {
			var then = new Date();
			var periodIsComplete = false;
			while (periodIsComplete == false) {
				var now = new Date();
				var elapsedMS = now.getTime() - then.getTime();
				if (elapsedMS >= periodMS)
					periodIsComplete = true;
			}
			postMessage(periodMS);
		}
	};
	
	endlessLoop(event.data);		
};

