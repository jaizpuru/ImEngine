var ImEngine = ImEngine || {};

ImEngine = (function() {
	var $ = jQuery;
	$.fn.ieAnimate = ($.fn.transition && $.support.transition) ? $.fn.transition : $.fn.animate;

	ImUtils = {
		requestId: 0,
		imageCoversArea: function($img, box) {
			return $img.data('left') <= box.left &&
				$img.data('left') + $img.data('width') >= box.left + box.width &&
				$img.data('top') <= box.top &&
				$img.data('top') + $img.data('height') >= box.top + box.height;
		},

		defineNewAssetRect: function(frame, scale, state) {
			var tileFactor = {x: state.naturalSize.width * scale / 100 / 128, y: state.naturalSize.height * scale / 100 / 128};
			var left = Math.max(Math.floor(frame.left * tileFactor.x - 0.5), 0) / tileFactor.x,
				top = Math.max(Math.floor(frame.top * tileFactor.y - 0.5), 0) / tileFactor.y,
				width = Math.min((Math.ceil((frame.left + frame.width - left) * tileFactor.x + 0.5) / tileFactor.x), 100 - left),
				height = Math.min((Math.ceil((frame.top + frame.height - top) * tileFactor.y + 0.5) / tileFactor.y), 100- top);
			return { left: left, top: top, width: Math.min(width, 100), height: Math.min(height, 100) };
		},

		loadImageInstance: function(state, rect, zoom) {
			var ratio = {x: zoom * state.naturalSize.width / 100, y: zoom * state.naturalSize.height / 100};
			var src = state.source + (state.source.indexOf('?') > 0 ? '&' : '?') + '&scl=' + (Math.round(10000 / zoom) / 10000) + '&rect=' + Math.round(rect.left * ratio.x) + ',' + Math.round(rect.top * ratio.y) + ',' + Math.round(rect.width * ratio.x) + ',' + Math.round(rect.height * ratio.y);
			var def = $.Deferred();
			var i = $(new Image())
				.attr('src', src).attr('rid', ImUtils.requestId++)
				.css({width: rect.width + '%', height: rect.height + '%', left: rect.left + '%', top: rect.top + '%', opacity: 0, display: 'block', position: 'absolute'})
				.data('source', state.source).data('zoom', zoom).data('top', rect.top).data('left', rect.left).data('width', rect.width).data('height', rect.height).attr('loading', 'loading');

			i.on('load', function() {
					i.removeAttr('loading');
					def.resolve(i);
				})
			.on('error', function() {
				def.reject(i); 
			});

			return {promise: def.promise(), image: i};
		},

		getMinZoom: function(state) {
			return Math.max(state.container.width() / state.naturalSize.width, state.container.height() / state.naturalSize.height);
		},

		normalizeZoom: function(state, z) {
			// Bound zoom
			z = Math.min(Math.max(z, ImUtils.getMinZoom(state)), state.maxZoom);
			// Normalize zoom (only useful for API-defined zoom levels)
			z = Math.round(z * state.naturalSize.width * 10000) / (state.naturalSize.width * 10000);
				
			var closestMatch = null;
			for (var i = 0; i < state.zoomLevels.length; i++) {
				if (closestMatch == null || Math.abs(state.zoomLevels[i] - z) < Math.abs(closestMatch - z)) {
					closestMatch = state.zoomLevels[i];
				}
			}

			return (Math.abs(1 - z/closestMatch) < 0.03) ? closestMatch : z;
		},

		constraintPosition: function(state, left, top) {
			var minTop = state.container.height() - state.currentSize.height;
			var minLeft = state.container.width() - state.currentSize.width;
			
			newTop = Math.max(minTop, Math.min(top, 0));
			newLeft = Math.max(minLeft, Math.min(left, 0));
			
			return {left: newLeft, top: newTop};
		},

		constraintDimensions: function(state, width, height) {
			width = Math.max(width, state.container.width());
			height = Math.max(height, state.container.height());
			
			width = Math.min(width, state.naturalSize.width * state.maxZoom);
			height = Math.min(height, state.naturalSize.height * state.maxZoom);
			
			return {width: width, height: height};
		}
	};

	ImUserEventHandler = function(viewer, options) {
		var pointerEvents = ('ontouchstart' in window) ? ['touchstart', 'touchmove', 'touchend'] : ['mousedown', 'mousemove', 'mouseup'];
		var clickToZoom = options.clickToZoom == undefined ? true : options.clickToZoom;
		var wheelToZoom = options.wheelToZoom == undefined ? clickToZoom : options.wheelToZoom;
		var dragToPan = options.dragToPan == undefined ? true : options.dragToPan;
		var zoomStep = viewer.zoomStep || 1.5;
		var dragMultiplier = options.dragMultiplier || 1;
		var doc = $(document);

		//User interactions state
		var isMoving = false;
		var dragStart = null;
		var lastZoomEvent = new Date().getTime();

		viewer.container.on(pointerEvents[0], startDrag);
		viewer.container.on('mousewheel DOMMouseScroll', wheeled);
		
		function getMargin() {
			var box = viewer.container[0].getBoundingClientRect();
			return {left: box.left + document.body.scrollLeft,  top: box.top + document.body.scrollTop};
		}

		function getEventCoords(e) {
			return ('ontouchstart' in window)
				? { x: e.originalEvent.touches[0].pageX, y: e.originalEvent.touches[0].pageY }
				: { x: e.pageX, y: e.pageY };

		}
		function startDrag(e) {
			if (e.which == 1 && (dragToPan || clickToZoom)) {
				e.preventDefault();
				var coords = getEventCoords(e);
				dragStart = {x: coords.x, y: coords.y, top: parseInt(viewer.currentPosition.top), left: parseInt(viewer.currentPosition.left) };
				doc.on(pointerEvents[2], endDrag);
			}
			if (e.which == 1 && dragToPan) {
				doc.on(pointerEvents[1], dragging);
			}
		}

		function dragging(e) {
			e.preventDefault();
			var pos = getEventCoords(e);

			if (!isMoving && (Math.abs(pos.x - dragStart.x) + Math.abs(pos.y - dragStart.y) > 3)) {
				isMoving = true;
				viewer.container.trigger(ImEvents.Panning, {originalPosition: dragStart, inputMethod: ImEvents.InputMethod.Mouse});
			}

			if (isMoving) {
				var targetX = (pos.x - dragStart.x) * dragMultiplier + dragStart.left;
				var targetY = (pos.y - dragStart.y) * dragMultiplier + dragStart.top;
				viewer.currentPosition = ImUtils.constraintPosition(viewer, targetX, targetY);
				viewer.wrapper.css(viewer.currentPosition);
			}
		}

		function endDrag(e) {
			var pos = getEventCoords(e);
			if (dragToPan || clickToZoom) {
				e.preventDefault();
			}
			if ((dragToPan && isMoving) || (!dragToPan && Math.abs(pos.x - dragStart.x) + Math.abs(pos.y - dragStart.y) > 3)) {
				isMoving = false;
				if (dragToPan) {
					viewer.container.trigger(ImEvents.PanEnded, {originalPosition: dragStart, targetPosition: viewer.currentPosition, inputMethod: ImEvents.InputMethod.Mouse});
				}
			} else if (clickToZoom) {
				if (lastZoomEvent + viewer.regionTransitionLength < new Date().getTime()) {
					lastZoomEvent = new Date().getTime();
					zoomAttempted({x: pos.x, y: pos.y}, e.altKey || e.ctrlKey ? 1 / zoomStep : zoomStep);
				}
			}

			doc.off(pointerEvents[2], endDrag);
			doc.off(pointerEvents[1], dragging);
		}

		function wheeled(e) {
			if (wheelToZoom && !isMoving) {
				e.preventDefault();
				if (lastZoomEvent + viewer.regionTransitionLength < new Date().getTime()) {
					lastZoomEvent = new Date().getTime();
					var wheelDirectionDetail = e.originalEvent.wheelDelta || e.originalEvent.detail * -1;
					var intendedZoomStep = wheelDirectionDetail > 0 ? zoomStep : 1 / zoomStep;
					zoomAttempted({x: e.originalEvent.pageX, y: e.originalEvent.pageY}, intendedZoomStep);
				}
			}
		}

		function zoomAttempted(eventPosition, intendedZoomStep) {
			var zoomLevel = viewer.pub.getZoom();
			var newZoomLevel = ImUtils.normalizeZoom(viewer, zoomLevel * intendedZoomStep);
			if (newZoomLevel != zoomLevel) {
				var actualZoomStep = newZoomLevel / zoomLevel;
				
				var margin = getMargin();
				var clickedPosition = {x: eventPosition.x - margin.left - viewer.currentPosition.left, y: eventPosition.y - margin.top - viewer.currentPosition.top};

				// Click correction makes the clicked spot stay right under the cursor instead of at the center of the viewport.
				var distanceToCenter = { x: eventPosition.x - (margin.left + viewer.container.width() / 2), y: eventPosition.y - (margin.top + viewer.container.height() / 2) };
				clickedPosition = { x: clickedPosition.x - distanceToCenter.x / actualZoomStep, y: clickedPosition.y - distanceToCenter.y / actualZoomStep };
				
				var newCenter = {x: clickedPosition.x / zoomLevel, y: clickedPosition.y / zoomLevel};
				
				viewer.pub.goTo(newCenter.x, newCenter.y, newZoomLevel, false);
			}
		}

		this.detach = function() {
			viewer.container.off(pointerEvents[0], startDrag);
			viewer.container.off('mousewheel DOMMouseScroll', wheeled);
		};
	};

	ImEvents = {
		Ready: 'viewer:ready',
		ZoomChanging: 'viewer:zooming',
		ZoomChanged: 'viewer:zoomed',
		SourceChanged: 'viewer:sourceChanged',
		AssetLoadStatusChanged: 'viewer:loadStatusChanged',
		AssetLoadFailed: 'viewer:loadFailed',
		Panning: 'viewer:panning',
		PanEnded: 'viewer:panned',
		InputMethod: {API: "input:API", Mouse: 'input:mouse', Touch: 'input:touch'},
		AssetLoadStatus: {Idle: 'Idle', Detail: 'Detail', Background: 'Background'}
	};

	ImAssetHandler = function(state) {
		var minScale;
		var lastWorkingSource = null;
		var currentBg = null;
		var currentBgPromise = null;
		var latestLoadStatus = null;
		var latestRid = null;

		function init() {
			// attach to events
			state.container.on(ImEvents.SourceChanged, function() { updateImagery(false); });
			state.container.on(ImEvents.ZoomChanged, function() { updateImagery(false); });
			state.container.on(ImEvents.PanEnded, function() { updateImagery(true); });
		}

		function updateLoadStatus(newStatus) {
			if (newStatus == undefined) {
				var loadingAssets = state.wrapper.children('[loading="loading"]');
				newStatus = (loadingAssets.length > 0) ? (loadingAssets.filter('.bg').length > 0 ? ImEvents.AssetLoadStatus.Background : ImEvents.AssetLoadStatus.Detail) : ImEvents.AssetLoadStatus.Idle;
			}
			if (newStatus != latestLoadStatus)	{
				latestLoadStatus = newStatus;
				state.container.trigger(ImEvents.AssetLoadStatusChanged, {source: state.source, loadStatus: newStatus});
			}
		}
		
		function imageInstance(src, left, top, width, height, zoom) {
			return $('<img src="' + src + '"/>')
				.css({width: width + '%', height: height + '%', left: left + '%', top: top + '%', opacity: 0, display: 'block', position: 'absolute'})
				.data('source', state.source).data('zoom', zoom).data('top', top).data('left', left).data('width', width).data('height', height);
		}

		function abortPendingRequests() {
			state.wrapper.children('[loading="loading"]').attr('src', '').remove();
		}

		function updateBackground() {
			if (currentBg && currentBg.data('source') == state.source && currentBg.data('zoom') >= minScale) {
				return currentBgPromise;
			}

			abortPendingRequests();
			var intent = $.Deferred();
			var oldBg = state.wrapper.children().length == 0 ? null : state.wrapper.children().eq(0);

			//There's either no background, or the source just change and there's still an old background in place
			var bgLoadIntent = ImUtils.loadImageInstance(state, {left: 0, top: 0, width: 100, height: 100}, minScale);
			bgLoadIntent.image.addClass('bg');

			currentBg = bgLoadIntent.image;
			currentBgPromise = intent.promise();

			updateLoadStatus(ImEvents.AssetLoadStatus.Background);

			bgLoadIntent.promise.fail(function() {
				intent.reject();
			});
			bgLoadIntent.promise.done(function(newBg) {
				if (newBg.data('source') != state.source) {
					return;
				}

				state.wrapper.prepend(newBg);
				newBg.ieAnimate({'opacity': 1}, state.sourceTransitionLength, function() {
					state.wrapper.children(':not([rid="' + newBg.attr('rid') + '"])').remove();
					intent.resolve(newBg.data('source'));
				});

				// Fade out any existing assets but the new bg.
				state.wrapper.children(':not([rid="' + newBg.attr('rid') + '"])').ieAnimate({'opacity': 0}, state.sourceTransitionLength);
			});

			return intent.promise();
		}

		function updateImagery(clearActive) {
			if (clearActive) {
				var currentAssets = state.wrapper.children(':not(.bg)').css('opacity', 0);
			}

			// Calculate background target scale
			var minZoom = ImUtils.getMinZoom(state);
			var imgSizeSqrt = Math.sqrt(state.naturalSize.width * state.naturalSize.height) * minZoom;
			minScale = imgSizeSqrt > 500 ? minZoom : Math.min(1, minZoom * 2);

			// Make sure there's a proper background in place
			updateBackground().done(function(newBg) {
				lastWorkingSource = newBg;
				updateDetailedImagery();
				updateLoadStatus();
			}).fail(function() {
				//Background not found. Assuming this is a source problem, revert to previous background.
				state.container.trigger(ImEvents.AssetLoadFailed, {source: currentBg.data('source'), reverting: lastWorkingSource});
				if (lastWorkingSource) {
					state.pub.setSource(lastWorkingSource);
				}
			});
		}

		function updateDetailedImagery() {
			// Compile current status
			var correctedZoomLevel = Math.min(1, ImUtils.normalizeZoom(state, state.pub.getZoom()));
			var targetScaleLevel = Math.max(minScale, correctedZoomLevel);
			var currentFrame = state.pub.getCurrentFrameN();
			var currentAssets = state.wrapper.children();

			// Find the fittest loaded asset
			var loadedFittestAsset = null, fittestAssetLoadIntent = null;
			for (var i = 0; i < currentAssets.length; i++) {
				if (correctedZoomLevel <= currentAssets.eq(i).data('zoom') && ImUtils.imageCoversArea(currentAssets.eq(i), currentFrame)) {
					loadedFittestAsset = currentAssets.eq(i);
					break;
				}
			}

			if (loadedFittestAsset == null) {
				// If there's none, load a new one
				abortPendingRequests();
				fittestAssetLoadIntent = ImUtils.loadImageInstance(state, ImUtils.defineNewAssetRect(currentFrame, targetScaleLevel, state), targetScaleLevel);
				latestRid = fittestAssetLoadIntent.image.attr('rid');
				state.wrapper.append(fittestAssetLoadIntent.image);
			} else if (!loadedFittestAsset.attr('loading')) {
				// If the fittest asset is loaded, use it.
				abortPendingRequests();
				latestRid = loadedFittestAsset.attr('rid');
				var def = $.Deferred();
				fittestAssetLoadIntent = {promise: def.promise()};
				def.resolve(loadedFittestAsset);
			} else {
				// If the fittest asset was loading, this is a duplicate effort and should be terminated.
				latestRid = loadedFittestAsset.attr('rid');
				return;
			}

			fittestAssetLoadIntent.promise.done(function(asset) {
				if (asset.attr('rid') == latestRid) {
					updateLoadStatus();
					state.wrapper.children(':not(.bg, [rid="' + latestRid + '"])').css('opacity', 0);
					state.wrapper.children('[rid="' + latestRid + '"]').css('opacity', 1);
				}
			});
		}
		
		init();
		
		return {updateImagery: updateImagery};
	}

	ImViewer = function(container, initialSource, options) {
		function init() {
			var minZoom = ImUtils.getMinZoom(self);
			self.currentSize = { width: self.naturalSize.width * minZoom, height: self.naturalSize.height * minZoom };

			self.container.html(self.wrapper[0]).css({overflow: 'hidden', position: 'absolute'});
			self.wrapper.css('position', 'absolute').css({left: 0, top: 0}).css(self.currentSize);

			for(var zoom = minZoom; zoom <= self.maxZoom; zoom *= self.zoomStep) {
				var correctedZoom = Math.round(zoom * self.naturalSize.width) / self.naturalSize.width;
				self.zoomLevels.push(correctedZoom);
			}

			if (Math.abs(1 - self.maxZoom/self.zoomLevels[self.zoomLevels.length-1]) > 0.01) {
				var correctedMaxZoom = Math.round(self.maxZoom * self.naturalSize.width) / self.naturalSize.width;
				if (Math.abs(1 - correctedMaxZoom/self.zoomLevels[self.zoomLevels.length-1]) > 0.1) {
					self.zoomLevels.push(correctedMaxZoom);
				} else {
					self.zoomLevels[self.zoomLevels.length-1] = correctedMaxZoom;
				}
			}

			self.pub.goTo(options.centerX || self.naturalSize.width / 2, options.centerY || self.naturalSize.height / 2, options.zoom || minZoom, {regionTransitionLength: 0, noEvents: true}, true);

			assetHandler = ImAssetHandler(self);

			self.container.trigger(ImEvents.Ready);
			self.pub.setSource(initialSource);
		}

		function goToCurrentState(oldPosition, oldZoom, options, apiTriggered) {
			var inputMethod = apiTriggered ? ImEvents.InputMethod.API : ImEvents.InputMethod.Mouse;
			options = options || {};

			// Pre-events
			if (!options.noEvents && oldZoom && oldZoom != self.pub.getZoom()) {
				self.container.trigger(ImEvents.ZoomChanging, {originalZoom: oldZoom, targetZoom: self.pub.getZoom(), inputMethod: ImEvents.InputMethod.API});
			}
			if (!options.noEvents && oldPosition && self.currentPosition != oldPosition) {
				self.container.trigger(ImEvents.Panning, {originalPosition: oldPosition, targetPosition: self.currentPosition, inputMethod: ImEvents.InputMethod.API});
			}

			function postEvents() {
				if (!options.noEvents && oldZoom && oldZoom != self.pub.getZoom()) {
					self.container.trigger(ImEvents.ZoomChanged, {originalZoom: oldZoom, targetZoom: self.pub.getZoom(), inputMethod: ImEvents.InputMethod.API});
				}
				if (!options.noEvents && oldPosition && self.currentPosition != oldPosition) {
					self.container.trigger(ImEvents.PanEnded, {originalPosition: oldPosition, targetPosition: self.currentPosition, inputMethod: ImEvents.InputMethod.API});
				}
			}

			self.wrapper.ieAnimate(
				{top: self.currentPosition.top, left: self.currentPosition.left, height: self.currentSize.height, width: self.currentSize.width},
				options.regionTransitionLength != undefined ? options.regionTransitionLength : self.regionTransitionLength,
				options.regionTransitionEasing != undefined ? options.regionTransitionEasing : self.regionTransitionEasing,
				postEvents
			);
		}

		options = options || {};

		// Protected state
		this.maxZoom = options.maxZoom || 1;
		this.zoomStep = options.zoomStep || 1.5;
		this.regionTransitionEasing = options.regionTransitionEasing || 'linear';
		this.regionTransitionLength = options.regionTransitionLength || 400;
		this.sourceTransitionLength = options.sourceTransitionLength || 500;
		this.naturalSize = {width: options.imageWidth, height: options.imageHeight};
		this.zoomLevels = [];
		this.wrapper = $('<div></div>');
		this.container = $('#' + container);
		this.source = null;

		// Internal state
		var self = this;
		var eventHandler = new ImUserEventHandler(self, options);
		var assetHandler = null;

		// Parameters validation
		var supportedEasingFunctions = ['swing', 'linear', 'easeOutCubic', 'easeInOutCubic', 'easeInCirc','easeOutCirc','easeInOutCirc','easeInExpo','easeOutExpo','easeInOutExpo','easeInQuad','easeOutQuad','easeInOutQuad','easeInQuart','easeOutQuart','easeInOutQuart','easeInQuint','easeOutQuint','easeInOutQuint','easeInSine','easeOutSine','easeInOutSine','easeInBack','easeOutBack','easeInOutBack'];
		if ($.inArray(this.regionTransitionEasing, supportedEasingFunctions) < 0) {
			throw 'Provided easing function is not supported: ' + this.regionTransitionEasing;
		} else if (!$.easing[this.regionTransitionEasing]) {
			throw 'Provided easing function not present: ' + this.regionTransitionEasing;
		}

		// Public state
		this.pub = {};
		this.pub.getZoom = function() {
			return self.currentSize.width / self.naturalSize.width;
		};

		this.pub.getPosition = function() {
			return {
				x: (self.container.width() / 2 - self.currentPosition.left) / self.pub.getZoom(), 
				y: (self.container.height() / 2 - self.currentPosition.top) / self.pub.getZoom()
			};
		};

		this.pub.getCurrentFrameN = function() {
			var zoom = self.pub.getZoom();
			return {
				left: Math.round(1000000 * -self.currentPosition.left / (zoom * self.naturalSize.width)) / 10000,
				top: Math.round(1000000 * -self.currentPosition.top / (zoom * self.naturalSize.height)) / 10000,
				width: Math.round(1000000 * self.container.width() / (zoom * self.naturalSize.width)) / 10000, 
				height: Math.round(1000000 * self.container.height() / (zoom * self.naturalSize.height)) / 10000
			};
		};

		this.pub.goToFrame = function(left, top, width, height, options) {
			var oldPosition = self.currentPosition;
			var oldZoom = self.pub.getZoom();

			var usedZoom = ImUtils.normalizeZoom(self, Math.min(self.container.width() / width, self.container.height() / height));
			height = usedZoom * self.naturalSize.height;
			width = usedZoom * self.naturalSize.width;
			self.currentSize = ImUtils.constraintDimensions(self, width, height);
			self.currentPosition = ImUtils.constraintPosition(self, -left, -top);

			goToCurrentState(oldPosition, oldZoom, options, true);
		};

		this.pub.goTo = function(x, y, zoom, options, apiTriggered) {
			var oldZoom = self.pub.getZoom();
			var newZoom = zoom != undefined ? ImUtils.normalizeZoom(self, zoom) : oldZoom;
			var oldPosition = self.currentPosition;

			self.currentSize = {width: Math.round(self.naturalSize.width * newZoom), height: Math.round(self.naturalSize.height * newZoom)};
			self.currentPosition = ImUtils.constraintPosition(self, -Math.round(x * newZoom - self.container.width() / 2), -Math.round(y * newZoom - self.container.height() / 2));

			goToCurrentState(oldPosition, oldZoom, options, apiTriggered == true);
		};

		this.pub.setSource = function(newSource) {
			if (newSource != self.source) {
				var oldSource = self.source;
				self.source = newSource;
				self.container.trigger(ImEvents.SourceChanged, { oldSource: oldSource });
			}
		};

		this.pub.resize = function(width, height, options) {
			options = options || {};
			var oldZoom = self.pub.getZoom();
			var oldPosition = self.currentPosition;
			
			var zoomChange = Math.max(width / self.container.width(), height / self.container.height());
			var newZoom = Math.min(zoomChange * self.pub.getZoom(), self.maxZoom);
			var cp = self.pub.getPosition();

			self.currentSize = {width: Math.round(self.naturalSize.width * newZoom), height: Math.round(self.naturalSize.height * newZoom)};
			self.currentPosition = {left: -Math.round(cp.x * newZoom - width / 2), top: -Math.round(cp.y * newZoom - height / 2)};

			self.container.ieAnimate(
				{width: width, height: height},
				options.regionTransitionLength != undefined ? options.regionTransitionLength : self.regionTransitionLength,
				options.regionTransitionEasing != undefined ? options.regionTransitionEasing : self.regionTransitionEasing
			);

			goToCurrentState(oldPosition, oldZoom, options, true);
		};
		
		this.pub.detach = function() { eventHandler.detach(); }
		this.pub.on = function(e, h) { self.container.on(e, h); };
		this.pub.off = function(e, h) { self.container.off(e, h); };

		if (!this.naturalSize.width || !this.naturalSize.height) {
			window.s7jsonResponse = function(d) {
				var dims = d['image.rect'].split(',');
				self.naturalSize = {width: parseInt(dims[2]), height: parseInt(dims[3])};
				init();
			};

			$.ajax(initialSource + '&req=ctx,json', {dataType: 'jsonp'});
		} else {
			setTimeout(init, 0);
		}

		return this;
	};

	return {
		Events: ImEvents,
		GetViewerFor: function(container, initialSource, options) {
			var v = new ImViewer(container, initialSource, options);
			return v.pub;
		}
	};
})(jQuery);
