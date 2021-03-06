(function (window, angular, undefined) {
  'use strict';
  angular.module('ngAnimate', ['ng']).factory('$$animateReflow', [
    '$$rAF',
    '$document',
    function ($$rAF, $document) {
      var bod = $document[0].body;
      return function (fn) {
        return $$rAF(function () {
          var a = bod.offsetWidth + 1;
          fn();
        });
      };
    }
  ]).config([
    '$provide',
    '$animateProvider',
    function ($provide, $animateProvider) {
      var noop = angular.noop;
      var forEach = angular.forEach;
      var selectors = $animateProvider.$$selectors;
      var ELEMENT_NODE = 1;
      var NG_ANIMATE_STATE = '$$ngAnimateState';
      var NG_ANIMATE_CLASS_NAME = 'ng-animate';
      var rootAnimateState = { running: true };
      function extractElementNode(element) {
        for (var i = 0; i < element.length; i++) {
          var elm = element[i];
          if (elm.nodeType == ELEMENT_NODE) {
            return elm;
          }
        }
      }
      function stripCommentsFromElement(element) {
        return angular.element(extractElementNode(element));
      }
      function isMatchingElement(elm1, elm2) {
        return extractElementNode(elm1) == extractElementNode(elm2);
      }
      $provide.decorator('$animate', [
        '$delegate',
        '$injector',
        '$sniffer',
        '$rootElement',
        '$$asyncCallback',
        '$rootScope',
        '$document',
        function ($delegate, $injector, $sniffer, $rootElement, $$asyncCallback, $rootScope, $document) {
          var globalAnimationCounter = 0;
          $rootElement.data(NG_ANIMATE_STATE, rootAnimateState);
          $rootScope.$$postDigest(function () {
            $rootScope.$$postDigest(function () {
              rootAnimateState.running = false;
            });
          });
          var classNameFilter = $animateProvider.classNameFilter();
          var isAnimatableClassName = !classNameFilter ? function () {
              return true;
            } : function (className) {
              return classNameFilter.test(className);
            };
          function lookup(name) {
            if (name) {
              var matches = [], flagMap = {}, classes = name.substr(1).split('.');
              if ($sniffer.transitions || $sniffer.animations) {
                classes.push('');
              }
              for (var i = 0; i < classes.length; i++) {
                var klass = classes[i], selectorFactoryName = selectors[klass];
                if (selectorFactoryName && !flagMap[klass]) {
                  matches.push($injector.get(selectorFactoryName));
                  flagMap[klass] = true;
                }
              }
              return matches;
            }
          }
          return {
            enter: function (element, parentElement, afterElement, doneCallback) {
              this.enabled(false, element);
              $delegate.enter(element, parentElement, afterElement);
              $rootScope.$$postDigest(function () {
                element = stripCommentsFromElement(element);
                performAnimation('enter', 'ng-enter', element, parentElement, afterElement, noop, doneCallback);
              });
            },
            leave: function (element, doneCallback) {
              cancelChildAnimations(element);
              this.enabled(false, element);
              $rootScope.$$postDigest(function () {
                element = stripCommentsFromElement(element);
                performAnimation('leave', 'ng-leave', element, null, null, function () {
                  $delegate.leave(element);
                }, doneCallback);
              });
            },
            move: function (element, parentElement, afterElement, doneCallback) {
              cancelChildAnimations(element);
              this.enabled(false, element);
              $delegate.move(element, parentElement, afterElement);
              $rootScope.$$postDigest(function () {
                element = stripCommentsFromElement(element);
                performAnimation('move', 'ng-move', element, parentElement, afterElement, noop, doneCallback);
              });
            },
            addClass: function (element, className, doneCallback) {
              element = stripCommentsFromElement(element);
              performAnimation('addClass', className, element, null, null, function () {
                $delegate.addClass(element, className);
              }, doneCallback);
            },
            removeClass: function (element, className, doneCallback) {
              element = stripCommentsFromElement(element);
              performAnimation('removeClass', className, element, null, null, function () {
                $delegate.removeClass(element, className);
              }, doneCallback);
            },
            setClass: function (element, add, remove, doneCallback) {
              element = stripCommentsFromElement(element);
              performAnimation('setClass', [
                add,
                remove
              ], element, null, null, function () {
                $delegate.setClass(element, add, remove);
              }, doneCallback);
            },
            enabled: function (value, element) {
              switch (arguments.length) {
              case 2:
                if (value) {
                  cleanup(element);
                } else {
                  var data = element.data(NG_ANIMATE_STATE) || {};
                  data.disabled = true;
                  element.data(NG_ANIMATE_STATE, data);
                }
                break;
              case 1:
                rootAnimateState.disabled = !value;
                break;
              default:
                value = !rootAnimateState.disabled;
                break;
              }
              return !!value;
            }
          };
          function performAnimation(animationEvent, className, element, parentElement, afterElement, domOperation, doneCallback) {
            var classNameAdd, classNameRemove, setClassOperation = animationEvent == 'setClass';
            if (setClassOperation) {
              classNameAdd = className[0];
              classNameRemove = className[1];
              className = classNameAdd + ' ' + classNameRemove;
            }
            var currentClassName, classes, node = element[0];
            if (node) {
              currentClassName = node.className;
              classes = currentClassName + ' ' + className;
            }
            if (!node || !isAnimatableClassName(classes)) {
              fireDOMOperation();
              fireBeforeCallbackAsync();
              fireAfterCallbackAsync();
              fireDoneCallbackAsync();
              return;
            }
            var elementEvents = angular.element._data(node);
            elementEvents = elementEvents && elementEvents.events;
            var animationLookup = (' ' + classes).replace(/\s+/g, '.');
            if (!parentElement) {
              parentElement = afterElement ? afterElement.parent() : element.parent();
            }
            var matches = lookup(animationLookup);
            var isClassBased = animationEvent == 'addClass' || animationEvent == 'removeClass' || setClassOperation;
            var ngAnimateState = element.data(NG_ANIMATE_STATE) || {};
            var runningAnimations = ngAnimateState.active || {};
            var totalActiveAnimations = ngAnimateState.totalActive || 0;
            var lastAnimation = ngAnimateState.last;
            if (animationsDisabled(element, parentElement) || matches.length === 0) {
              fireDOMOperation();
              fireBeforeCallbackAsync();
              fireAfterCallbackAsync();
              closeAnimation();
              return;
            }
            var animations = [];
            var allowAnimations = isClassBased ? !ngAnimateState.disabled && (!lastAnimation || lastAnimation.classBased) : true;
            if (allowAnimations) {
              forEach(matches, function (animation) {
                if (!animation.allowCancel || animation.allowCancel(element, animationEvent, className)) {
                  var beforeFn, afterFn = animation[animationEvent];
                  if (animationEvent == 'leave') {
                    beforeFn = afterFn;
                    afterFn = null;
                  } else {
                    beforeFn = animation['before' + animationEvent.charAt(0).toUpperCase() + animationEvent.substr(1)];
                  }
                  animations.push({
                    before: beforeFn,
                    after: afterFn
                  });
                }
              });
            }
            if (animations.length === 0) {
              fireDOMOperation();
              fireBeforeCallbackAsync();
              fireAfterCallbackAsync();
              fireDoneCallbackAsync();
              return;
            }
            var skipAnimation = false;
            if (totalActiveAnimations > 0) {
              var animationsToCancel = [];
              if (!isClassBased) {
                if (animationEvent == 'leave' && runningAnimations['ng-leave']) {
                  skipAnimation = true;
                } else {
                  for (var klass in runningAnimations) {
                    animationsToCancel.push(runningAnimations[klass]);
                    cleanup(element, klass);
                  }
                  runningAnimations = {};
                  totalActiveAnimations = 0;
                }
              } else if (lastAnimation.event == 'setClass') {
                animationsToCancel.push(lastAnimation);
                cleanup(element, className);
              } else if (runningAnimations[className]) {
                var current = runningAnimations[className];
                if (current.event == animationEvent) {
                  skipAnimation = true;
                } else {
                  animationsToCancel.push(current);
                  cleanup(element, className);
                }
              }
              if (animationsToCancel.length > 0) {
                angular.forEach(animationsToCancel, function (operation) {
                  (operation.done || noop)(true);
                  cancelAnimations(operation.animations);
                });
              }
            }
            if (isClassBased && !setClassOperation && !skipAnimation) {
              skipAnimation = animationEvent == 'addClass' == element.hasClass(className);
            }
            if (skipAnimation) {
              fireBeforeCallbackAsync();
              fireAfterCallbackAsync();
              fireDoneCallbackAsync();
              return;
            }
            element.addClass(NG_ANIMATE_CLASS_NAME);
            var localAnimationCount = globalAnimationCounter++;
            lastAnimation = {
              classBased: isClassBased,
              event: animationEvent,
              animations: animations,
              done: onBeforeAnimationsComplete
            };
            totalActiveAnimations++;
            runningAnimations[className] = lastAnimation;
            element.data(NG_ANIMATE_STATE, {
              last: lastAnimation,
              active: runningAnimations,
              index: localAnimationCount,
              totalActive: totalActiveAnimations
            });
            invokeRegisteredAnimationFns(animations, 'before', onBeforeAnimationsComplete);
            function onBeforeAnimationsComplete(cancelled) {
              var data = element.data(NG_ANIMATE_STATE);
              cancelled = cancelled || !data || !data.active[className] || isClassBased && data.active[className].event != animationEvent;
              fireDOMOperation();
              if (cancelled === true) {
                closeAnimation();
                return;
              }
              var currentAnimation = data.active[className];
              currentAnimation.done = closeAnimation;
              invokeRegisteredAnimationFns(animations, 'after', closeAnimation);
            }
            function invokeRegisteredAnimationFns(animations, phase, allAnimationFnsComplete) {
              phase == 'after' ? fireAfterCallbackAsync() : fireBeforeCallbackAsync();
              var endFnName = phase + 'End';
              forEach(animations, function (animation, index) {
                var animationPhaseCompleted = function () {
                  progress(index, phase);
                };
                if (phase == 'before' && (animationEvent == 'enter' || animationEvent == 'move')) {
                  animationPhaseCompleted();
                  return;
                }
                if (animation[phase]) {
                  if (setClassOperation) {
                    animation[endFnName] = animation[phase](element, classNameAdd, classNameRemove, animationPhaseCompleted);
                  } else {
                    animation[endFnName] = isClassBased ? animation[phase](element, className, animationPhaseCompleted) : animation[phase](element, animationPhaseCompleted);
                  }
                } else {
                  animationPhaseCompleted();
                }
              });
              function progress(index, phase) {
                var phaseCompletionFlag = phase + 'Complete';
                var currentAnimation = animations[index];
                currentAnimation[phaseCompletionFlag] = true;
                (currentAnimation[endFnName] || noop)();
                for (var i = 0; i < animations.length; i++) {
                  if (!animations[i][phaseCompletionFlag])
                    return;
                }
                allAnimationFnsComplete();
              }
            }
            function fireDOMCallback(animationPhase) {
              var eventName = '$animate:' + animationPhase;
              if (elementEvents && elementEvents[eventName] && elementEvents[eventName].length > 0) {
                $$asyncCallback(function () {
                  element.triggerHandler(eventName, {
                    event: animationEvent,
                    className: className
                  });
                });
              }
            }
            function fireBeforeCallbackAsync() {
              fireDOMCallback('before');
            }
            function fireAfterCallbackAsync() {
              fireDOMCallback('after');
            }
            function fireDoneCallbackAsync() {
              fireDOMCallback('close');
              if (doneCallback) {
                $$asyncCallback(function () {
                  doneCallback();
                });
              }
            }
            function fireDOMOperation() {
              if (!fireDOMOperation.hasBeenRun) {
                fireDOMOperation.hasBeenRun = true;
                domOperation();
              }
            }
            function closeAnimation() {
              if (!closeAnimation.hasBeenRun) {
                closeAnimation.hasBeenRun = true;
                var data = element.data(NG_ANIMATE_STATE);
                if (data) {
                  if (isClassBased) {
                    cleanup(element, className);
                  } else {
                    $$asyncCallback(function () {
                      var data = element.data(NG_ANIMATE_STATE) || {};
                      if (localAnimationCount == data.index) {
                        cleanup(element, className, animationEvent);
                      }
                    });
                    element.data(NG_ANIMATE_STATE, data);
                  }
                }
                fireDoneCallbackAsync();
              }
            }
          }
          function cancelChildAnimations(element) {
            var node = extractElementNode(element);
            forEach(node.querySelectorAll('.' + NG_ANIMATE_CLASS_NAME), function (element) {
              element = angular.element(element);
              var data = element.data(NG_ANIMATE_STATE);
              if (data && data.active) {
                angular.forEach(data.active, function (operation) {
                  (operation.done || noop)(true);
                  cancelAnimations(operation.animations);
                });
              }
            });
          }
          function cancelAnimations(animations) {
            var isCancelledFlag = true;
            forEach(animations, function (animation) {
              if (!animation.beforeComplete) {
                (animation.beforeEnd || noop)(isCancelledFlag);
              }
              if (!animation.afterComplete) {
                (animation.afterEnd || noop)(isCancelledFlag);
              }
            });
          }
          function cleanup(element, className) {
            if (isMatchingElement(element, $rootElement)) {
              if (!rootAnimateState.disabled) {
                rootAnimateState.running = false;
                rootAnimateState.structural = false;
              }
            } else if (className) {
              var data = element.data(NG_ANIMATE_STATE) || {};
              var removeAnimations = className === true;
              if (!removeAnimations) {
                if (data.active && data.active[className]) {
                  data.totalActive--;
                  delete data.active[className];
                }
              }
              if (removeAnimations || !data.totalActive) {
                element.removeClass(NG_ANIMATE_CLASS_NAME);
                element.removeData(NG_ANIMATE_STATE);
              }
            }
          }
          function animationsDisabled(element, parentElement) {
            if (rootAnimateState.disabled)
              return true;
            if (isMatchingElement(element, $rootElement)) {
              return rootAnimateState.disabled || rootAnimateState.running;
            }
            do {
              if (parentElement.length === 0)
                break;
              var isRoot = isMatchingElement(parentElement, $rootElement);
              var state = isRoot ? rootAnimateState : parentElement.data(NG_ANIMATE_STATE);
              var result = state && (!!state.disabled || state.running || state.totalActive > 0);
              if (isRoot || result) {
                return result;
              }
              if (isRoot)
                return true;
            } while (parentElement = parentElement.parent());
            return true;
          }
        }
      ]);
      $animateProvider.register('', [
        '$window',
        '$sniffer',
        '$timeout',
        '$$animateReflow',
        function ($window, $sniffer, $timeout, $$animateReflow) {
          var CSS_PREFIX = '', TRANSITION_PROP, TRANSITIONEND_EVENT, ANIMATION_PROP, ANIMATIONEND_EVENT;
          if (window.ontransitionend === undefined && window.onwebkittransitionend !== undefined) {
            CSS_PREFIX = '-webkit-';
            TRANSITION_PROP = 'WebkitTransition';
            TRANSITIONEND_EVENT = 'webkitTransitionEnd transitionend';
          } else {
            TRANSITION_PROP = 'transition';
            TRANSITIONEND_EVENT = 'transitionend';
          }
          if (window.onanimationend === undefined && window.onwebkitanimationend !== undefined) {
            CSS_PREFIX = '-webkit-';
            ANIMATION_PROP = 'WebkitAnimation';
            ANIMATIONEND_EVENT = 'webkitAnimationEnd animationend';
          } else {
            ANIMATION_PROP = 'animation';
            ANIMATIONEND_EVENT = 'animationend';
          }
          var DURATION_KEY = 'Duration';
          var PROPERTY_KEY = 'Property';
          var DELAY_KEY = 'Delay';
          var ANIMATION_ITERATION_COUNT_KEY = 'IterationCount';
          var NG_ANIMATE_PARENT_KEY = '$$ngAnimateKey';
          var NG_ANIMATE_CSS_DATA_KEY = '$$ngAnimateCSS3Data';
          var NG_ANIMATE_BLOCK_CLASS_NAME = 'ng-animate-block-transitions';
          var ELAPSED_TIME_MAX_DECIMAL_PLACES = 3;
          var CLOSING_TIME_BUFFER = 1.5;
          var ONE_SECOND = 1000;
          var lookupCache = {};
          var parentCounter = 0;
          var animationReflowQueue = [];
          var cancelAnimationReflow;
          function afterReflow(element, callback) {
            if (cancelAnimationReflow) {
              cancelAnimationReflow();
            }
            animationReflowQueue.push(callback);
            cancelAnimationReflow = $$animateReflow(function () {
              forEach(animationReflowQueue, function (fn) {
                fn();
              });
              animationReflowQueue = [];
              cancelAnimationReflow = null;
              lookupCache = {};
            });
          }
          var closingTimer = null;
          var closingTimestamp = 0;
          var animationElementQueue = [];
          function animationCloseHandler(element, totalTime) {
            var futureTimestamp = Date.now() + totalTime * 1000;
            if (futureTimestamp <= closingTimestamp) {
              return;
            }
            $timeout.cancel(closingTimer);
            var node = extractElementNode(element);
            element = angular.element(node);
            animationElementQueue.push(element);
            closingTimestamp = futureTimestamp;
            closingTimer = $timeout(function () {
              closeAllAnimations(animationElementQueue);
              animationElementQueue = [];
            }, totalTime, false);
          }
          function closeAllAnimations(elements) {
            forEach(elements, function (element) {
              var elementData = element.data(NG_ANIMATE_CSS_DATA_KEY);
              if (elementData) {
                (elementData.closeAnimationFn || noop)();
              }
            });
          }
          function getElementAnimationDetails(element, cacheKey) {
            var data = cacheKey ? lookupCache[cacheKey] : null;
            if (!data) {
              var transitionDuration = 0;
              var transitionDelay = 0;
              var animationDuration = 0;
              var animationDelay = 0;
              var transitionDelayStyle;
              var animationDelayStyle;
              var transitionDurationStyle;
              var transitionPropertyStyle;
              forEach(element, function (element) {
                if (element.nodeType == ELEMENT_NODE) {
                  var elementStyles = $window.getComputedStyle(element) || {};
                  transitionDurationStyle = elementStyles[TRANSITION_PROP + DURATION_KEY];
                  transitionDuration = Math.max(parseMaxTime(transitionDurationStyle), transitionDuration);
                  transitionPropertyStyle = elementStyles[TRANSITION_PROP + PROPERTY_KEY];
                  transitionDelayStyle = elementStyles[TRANSITION_PROP + DELAY_KEY];
                  transitionDelay = Math.max(parseMaxTime(transitionDelayStyle), transitionDelay);
                  animationDelayStyle = elementStyles[ANIMATION_PROP + DELAY_KEY];
                  animationDelay = Math.max(parseMaxTime(animationDelayStyle), animationDelay);
                  var aDuration = parseMaxTime(elementStyles[ANIMATION_PROP + DURATION_KEY]);
                  if (aDuration > 0) {
                    aDuration *= parseInt(elementStyles[ANIMATION_PROP + ANIMATION_ITERATION_COUNT_KEY], 10) || 1;
                  }
                  animationDuration = Math.max(aDuration, animationDuration);
                }
              });
              data = {
                total: 0,
                transitionPropertyStyle: transitionPropertyStyle,
                transitionDurationStyle: transitionDurationStyle,
                transitionDelayStyle: transitionDelayStyle,
                transitionDelay: transitionDelay,
                transitionDuration: transitionDuration,
                animationDelayStyle: animationDelayStyle,
                animationDelay: animationDelay,
                animationDuration: animationDuration
              };
              if (cacheKey) {
                lookupCache[cacheKey] = data;
              }
            }
            return data;
          }
          function parseMaxTime(str) {
            var maxValue = 0;
            var values = angular.isString(str) ? str.split(/\s*,\s*/) : [];
            forEach(values, function (value) {
              maxValue = Math.max(parseFloat(value) || 0, maxValue);
            });
            return maxValue;
          }
          function getCacheKey(element) {
            var parentElement = element.parent();
            var parentID = parentElement.data(NG_ANIMATE_PARENT_KEY);
            if (!parentID) {
              parentElement.data(NG_ANIMATE_PARENT_KEY, ++parentCounter);
              parentID = parentCounter;
            }
            return parentID + '-' + extractElementNode(element).className;
          }
          function animateSetup(animationEvent, element, className, calculationDecorator) {
            var cacheKey = getCacheKey(element);
            var eventCacheKey = cacheKey + ' ' + className;
            var itemIndex = lookupCache[eventCacheKey] ? ++lookupCache[eventCacheKey].total : 0;
            var stagger = {};
            if (itemIndex > 0) {
              var staggerClassName = className + '-stagger';
              var staggerCacheKey = cacheKey + ' ' + staggerClassName;
              var applyClasses = !lookupCache[staggerCacheKey];
              applyClasses && element.addClass(staggerClassName);
              stagger = getElementAnimationDetails(element, staggerCacheKey);
              applyClasses && element.removeClass(staggerClassName);
            }
            calculationDecorator = calculationDecorator || function (fn) {
              return fn();
            };
            element.addClass(className);
            var formerData = element.data(NG_ANIMATE_CSS_DATA_KEY) || {};
            var timings = calculationDecorator(function () {
                return getElementAnimationDetails(element, eventCacheKey);
              });
            var transitionDuration = timings.transitionDuration;
            var animationDuration = timings.animationDuration;
            if (transitionDuration === 0 && animationDuration === 0) {
              element.removeClass(className);
              return false;
            }
            element.data(NG_ANIMATE_CSS_DATA_KEY, {
              running: formerData.running || 0,
              itemIndex: itemIndex,
              stagger: stagger,
              timings: timings,
              closeAnimationFn: angular.noop
            });
            var isCurrentlyAnimating = formerData.running > 0 || animationEvent == 'setClass';
            if (transitionDuration > 0) {
              blockTransitions(element, className, isCurrentlyAnimating);
            }
            if (animationDuration > 0) {
              blockKeyframeAnimations(element);
            }
            return true;
          }
          function isStructuralAnimation(className) {
            return className == 'ng-enter' || className == 'ng-move' || className == 'ng-leave';
          }
          function blockTransitions(element, className, isAnimating) {
            if (isStructuralAnimation(className) || !isAnimating) {
              extractElementNode(element).style[TRANSITION_PROP + PROPERTY_KEY] = 'none';
            } else {
              element.addClass(NG_ANIMATE_BLOCK_CLASS_NAME);
            }
          }
          function blockKeyframeAnimations(element) {
            extractElementNode(element).style[ANIMATION_PROP] = 'none 0s';
          }
          function unblockTransitions(element, className) {
            var prop = TRANSITION_PROP + PROPERTY_KEY;
            var node = extractElementNode(element);
            if (node.style[prop] && node.style[prop].length > 0) {
              node.style[prop] = '';
            }
            element.removeClass(NG_ANIMATE_BLOCK_CLASS_NAME);
          }
          function unblockKeyframeAnimations(element) {
            var prop = ANIMATION_PROP;
            var node = extractElementNode(element);
            if (node.style[prop] && node.style[prop].length > 0) {
              node.style[prop] = '';
            }
          }
          function animateRun(animationEvent, element, className, activeAnimationComplete) {
            var node = extractElementNode(element);
            var elementData = element.data(NG_ANIMATE_CSS_DATA_KEY);
            if (node.className.indexOf(className) == -1 || !elementData) {
              activeAnimationComplete();
              return;
            }
            var activeClassName = '';
            forEach(className.split(' '), function (klass, i) {
              activeClassName += (i > 0 ? ' ' : '') + klass + '-active';
            });
            var stagger = elementData.stagger;
            var timings = elementData.timings;
            var itemIndex = elementData.itemIndex;
            var maxDuration = Math.max(timings.transitionDuration, timings.animationDuration);
            var maxDelay = Math.max(timings.transitionDelay, timings.animationDelay);
            var maxDelayTime = maxDelay * ONE_SECOND;
            var startTime = Date.now();
            var css3AnimationEvents = ANIMATIONEND_EVENT + ' ' + TRANSITIONEND_EVENT;
            var style = '', appliedStyles = [];
            if (timings.transitionDuration > 0) {
              var propertyStyle = timings.transitionPropertyStyle;
              if (propertyStyle.indexOf('all') == -1) {
                style += CSS_PREFIX + 'transition-property: ' + propertyStyle + ';';
                style += CSS_PREFIX + 'transition-duration: ' + timings.transitionDurationStyle + ';';
                appliedStyles.push(CSS_PREFIX + 'transition-property');
                appliedStyles.push(CSS_PREFIX + 'transition-duration');
              }
            }
            if (itemIndex > 0) {
              if (stagger.transitionDelay > 0 && stagger.transitionDuration === 0) {
                var delayStyle = timings.transitionDelayStyle;
                style += CSS_PREFIX + 'transition-delay: ' + prepareStaggerDelay(delayStyle, stagger.transitionDelay, itemIndex) + '; ';
                appliedStyles.push(CSS_PREFIX + 'transition-delay');
              }
              if (stagger.animationDelay > 0 && stagger.animationDuration === 0) {
                style += CSS_PREFIX + 'animation-delay: ' + prepareStaggerDelay(timings.animationDelayStyle, stagger.animationDelay, itemIndex) + '; ';
                appliedStyles.push(CSS_PREFIX + 'animation-delay');
              }
            }
            if (appliedStyles.length > 0) {
              var oldStyle = node.getAttribute('style') || '';
              node.setAttribute('style', oldStyle + ' ' + style);
            }
            element.on(css3AnimationEvents, onAnimationProgress);
            element.addClass(activeClassName);
            elementData.closeAnimationFn = function () {
              onEnd();
              activeAnimationComplete();
            };
            var staggerTime = itemIndex * (Math.max(stagger.animationDelay, stagger.transitionDelay) || 0);
            var animationTime = (maxDelay + maxDuration) * CLOSING_TIME_BUFFER;
            var totalTime = (staggerTime + animationTime) * ONE_SECOND;
            elementData.running++;
            animationCloseHandler(element, totalTime);
            return onEnd;
            function onEnd(cancelled) {
              element.off(css3AnimationEvents, onAnimationProgress);
              element.removeClass(activeClassName);
              animateClose(element, className);
              var node = extractElementNode(element);
              for (var i in appliedStyles) {
                node.style.removeProperty(appliedStyles[i]);
              }
            }
            function onAnimationProgress(event) {
              event.stopPropagation();
              var ev = event.originalEvent || event;
              var timeStamp = ev.$manualTimeStamp || ev.timeStamp || Date.now();
              var elapsedTime = parseFloat(ev.elapsedTime.toFixed(ELAPSED_TIME_MAX_DECIMAL_PLACES));
              if (Math.max(timeStamp - startTime, 0) >= maxDelayTime && elapsedTime >= maxDuration) {
                activeAnimationComplete();
              }
            }
          }
          function prepareStaggerDelay(delayStyle, staggerDelay, index) {
            var style = '';
            forEach(delayStyle.split(','), function (val, i) {
              style += (i > 0 ? ',' : '') + (index * staggerDelay + parseInt(val, 10)) + 's';
            });
            return style;
          }
          function animateBefore(animationEvent, element, className, calculationDecorator) {
            if (animateSetup(animationEvent, element, className, calculationDecorator)) {
              return function (cancelled) {
                cancelled && animateClose(element, className);
              };
            }
          }
          function animateAfter(animationEvent, element, className, afterAnimationComplete) {
            if (element.data(NG_ANIMATE_CSS_DATA_KEY)) {
              return animateRun(animationEvent, element, className, afterAnimationComplete);
            } else {
              animateClose(element, className);
              afterAnimationComplete();
            }
          }
          function animate(animationEvent, element, className, animationComplete) {
            var preReflowCancellation = animateBefore(animationEvent, element, className);
            if (!preReflowCancellation) {
              animationComplete();
              return;
            }
            var cancel = preReflowCancellation;
            afterReflow(element, function () {
              unblockTransitions(element, className);
              unblockKeyframeAnimations(element);
              cancel = animateAfter(animationEvent, element, className, animationComplete);
            });
            return function (cancelled) {
              (cancel || noop)(cancelled);
            };
          }
          function animateClose(element, className) {
            element.removeClass(className);
            var data = element.data(NG_ANIMATE_CSS_DATA_KEY);
            if (data) {
              if (data.running) {
                data.running--;
              }
              if (!data.running || data.running === 0) {
                element.removeData(NG_ANIMATE_CSS_DATA_KEY);
              }
            }
          }
          return {
            enter: function (element, animationCompleted) {
              return animate('enter', element, 'ng-enter', animationCompleted);
            },
            leave: function (element, animationCompleted) {
              return animate('leave', element, 'ng-leave', animationCompleted);
            },
            move: function (element, animationCompleted) {
              return animate('move', element, 'ng-move', animationCompleted);
            },
            beforeSetClass: function (element, add, remove, animationCompleted) {
              var className = suffixClasses(remove, '-remove') + ' ' + suffixClasses(add, '-add');
              var cancellationMethod = animateBefore('setClass', element, className, function (fn) {
                  var klass = element.attr('class');
                  element.removeClass(remove);
                  element.addClass(add);
                  var timings = fn();
                  element.attr('class', klass);
                  return timings;
                });
              if (cancellationMethod) {
                afterReflow(element, function () {
                  unblockTransitions(element, className);
                  unblockKeyframeAnimations(element);
                  animationCompleted();
                });
                return cancellationMethod;
              }
              animationCompleted();
            },
            beforeAddClass: function (element, className, animationCompleted) {
              var cancellationMethod = animateBefore('addClass', element, suffixClasses(className, '-add'), function (fn) {
                  element.addClass(className);
                  var timings = fn();
                  element.removeClass(className);
                  return timings;
                });
              if (cancellationMethod) {
                afterReflow(element, function () {
                  unblockTransitions(element, className);
                  unblockKeyframeAnimations(element);
                  animationCompleted();
                });
                return cancellationMethod;
              }
              animationCompleted();
            },
            setClass: function (element, add, remove, animationCompleted) {
              remove = suffixClasses(remove, '-remove');
              add = suffixClasses(add, '-add');
              var className = remove + ' ' + add;
              return animateAfter('setClass', element, className, animationCompleted);
            },
            addClass: function (element, className, animationCompleted) {
              return animateAfter('addClass', element, suffixClasses(className, '-add'), animationCompleted);
            },
            beforeRemoveClass: function (element, className, animationCompleted) {
              var cancellationMethod = animateBefore('removeClass', element, suffixClasses(className, '-remove'), function (fn) {
                  var klass = element.attr('class');
                  element.removeClass(className);
                  var timings = fn();
                  element.attr('class', klass);
                  return timings;
                });
              if (cancellationMethod) {
                afterReflow(element, function () {
                  unblockTransitions(element, className);
                  unblockKeyframeAnimations(element);
                  animationCompleted();
                });
                return cancellationMethod;
              }
              animationCompleted();
            },
            removeClass: function (element, className, animationCompleted) {
              return animateAfter('removeClass', element, suffixClasses(className, '-remove'), animationCompleted);
            }
          };
          function suffixClasses(classes, suffix) {
            var className = '';
            classes = angular.isArray(classes) ? classes : classes.split(/\s+/);
            forEach(classes, function (klass, i) {
              if (klass && klass.length > 0) {
                className += (i > 0 ? ' ' : '') + klass + suffix;
              }
            });
            return className;
          }
        }
      ]);
    }
  ]);
}(window, window.angular));
(function (window, angular, undefined) {
  'use strict';
  var ngTouch = angular.module('ngTouch', []);
  ngTouch.factory('$swipe', [function () {
      var MOVE_BUFFER_RADIUS = 10;
      function getCoordinates(event) {
        var touches = event.touches && event.touches.length ? event.touches : [event];
        var e = event.changedTouches && event.changedTouches[0] || event.originalEvent && event.originalEvent.changedTouches && event.originalEvent.changedTouches[0] || touches[0].originalEvent || touches[0];
        return {
          x: e.clientX,
          y: e.clientY
        };
      }
      return {
        bind: function (element, eventHandlers) {
          var totalX, totalY;
          var startCoords;
          var lastPos;
          var active = false;
          element.on('touchstart mousedown', function (event) {
            startCoords = getCoordinates(event);
            active = true;
            totalX = 0;
            totalY = 0;
            lastPos = startCoords;
            eventHandlers['start'] && eventHandlers['start'](startCoords, event);
          });
          element.on('touchcancel', function (event) {
            active = false;
            eventHandlers['cancel'] && eventHandlers['cancel'](event);
          });
          element.on('touchmove mousemove', function (event) {
            if (!active)
              return;
            if (!startCoords)
              return;
            var coords = getCoordinates(event);
            totalX += Math.abs(coords.x - lastPos.x);
            totalY += Math.abs(coords.y - lastPos.y);
            lastPos = coords;
            if (totalX < MOVE_BUFFER_RADIUS && totalY < MOVE_BUFFER_RADIUS) {
              return;
            }
            if (totalY > totalX) {
              active = false;
              eventHandlers['cancel'] && eventHandlers['cancel'](event);
              return;
            } else {
              event.preventDefault();
              eventHandlers['move'] && eventHandlers['move'](coords, event);
            }
          });
          element.on('touchend mouseup', function (event) {
            if (!active)
              return;
            active = false;
            eventHandlers['end'] && eventHandlers['end'](getCoordinates(event), event);
          });
        }
      };
    }]);
  ngTouch.config([
    '$provide',
    function ($provide) {
      $provide.decorator('ngClickDirective', [
        '$delegate',
        function ($delegate) {
          $delegate.shift();
          return $delegate;
        }
      ]);
    }
  ]);
  ngTouch.directive('ngClick', [
    '$parse',
    '$timeout',
    '$rootElement',
    function ($parse, $timeout, $rootElement) {
      var TAP_DURATION = 750;
      var MOVE_TOLERANCE = 12;
      var PREVENT_DURATION = 2500;
      var CLICKBUSTER_THRESHOLD = 25;
      var ACTIVE_CLASS_NAME = 'ng-click-active';
      var lastPreventedTime;
      var touchCoordinates;
      function hit(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) < CLICKBUSTER_THRESHOLD && Math.abs(y1 - y2) < CLICKBUSTER_THRESHOLD;
      }
      function checkAllowableRegions(touchCoordinates, x, y) {
        for (var i = 0; i < touchCoordinates.length; i += 2) {
          if (hit(touchCoordinates[i], touchCoordinates[i + 1], x, y)) {
            touchCoordinates.splice(i, i + 2);
            return true;
          }
        }
        return false;
      }
      function onClick(event) {
        if (Date.now() - lastPreventedTime > PREVENT_DURATION) {
          return;
        }
        var touches = event.touches && event.touches.length ? event.touches : [event];
        var x = touches[0].clientX;
        var y = touches[0].clientY;
        if (x < 1 && y < 1) {
          return;
        }
        if (checkAllowableRegions(touchCoordinates, x, y)) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        event.target && event.target.blur();
      }
      function onTouchStart(event) {
        var touches = event.touches && event.touches.length ? event.touches : [event];
        var x = touches[0].clientX;
        var y = touches[0].clientY;
        touchCoordinates.push(x, y);
        $timeout(function () {
          for (var i = 0; i < touchCoordinates.length; i += 2) {
            if (touchCoordinates[i] == x && touchCoordinates[i + 1] == y) {
              touchCoordinates.splice(i, i + 2);
              return;
            }
          }
        }, PREVENT_DURATION, false);
      }
      function preventGhostClick(x, y) {
        if (!touchCoordinates) {
          $rootElement[0].addEventListener('click', onClick, true);
          $rootElement[0].addEventListener('touchstart', onTouchStart, true);
          touchCoordinates = [];
        }
        lastPreventedTime = Date.now();
        checkAllowableRegions(touchCoordinates, x, y);
      }
      return function (scope, element, attr) {
        var clickHandler = $parse(attr.ngClick), tapping = false, tapElement, startTime, touchStartX, touchStartY;
        function resetState() {
          tapping = false;
          element.removeClass(ACTIVE_CLASS_NAME);
        }
        element.on('touchstart', function (event) {
          tapping = true;
          tapElement = event.target ? event.target : event.srcElement;
          if (tapElement.nodeType == 3) {
            tapElement = tapElement.parentNode;
          }
          element.addClass(ACTIVE_CLASS_NAME);
          startTime = Date.now();
          var touches = event.touches && event.touches.length ? event.touches : [event];
          var e = touches[0].originalEvent || touches[0];
          touchStartX = e.clientX;
          touchStartY = e.clientY;
        });
        element.on('touchmove', function (event) {
          resetState();
        });
        element.on('touchcancel', function (event) {
          resetState();
        });
        element.on('touchend', function (event) {
          var diff = Date.now() - startTime;
          var touches = event.changedTouches && event.changedTouches.length ? event.changedTouches : event.touches && event.touches.length ? event.touches : [event];
          var e = touches[0].originalEvent || touches[0];
          var x = e.clientX;
          var y = e.clientY;
          var dist = Math.sqrt(Math.pow(x - touchStartX, 2) + Math.pow(y - touchStartY, 2));
          if (tapping && diff < TAP_DURATION && dist < MOVE_TOLERANCE) {
            preventGhostClick(x, y);
            if (tapElement) {
              tapElement.blur();
            }
            if (!angular.isDefined(attr.disabled) || attr.disabled === false) {
              element.triggerHandler('click', [event]);
            }
          }
          resetState();
        });
        element.onclick = function (event) {
        };
        element.on('click', function (event, touchend) {
          scope.$apply(function () {
            clickHandler(scope, { $event: touchend || event });
          });
        });
        element.on('mousedown', function (event) {
          element.addClass(ACTIVE_CLASS_NAME);
        });
        element.on('mousemove mouseup', function (event) {
          element.removeClass(ACTIVE_CLASS_NAME);
        });
      };
    }
  ]);
  function makeSwipeDirective(directiveName, direction, eventName) {
    ngTouch.directive(directiveName, [
      '$parse',
      '$swipe',
      function ($parse, $swipe) {
        var MAX_VERTICAL_DISTANCE = 75;
        var MAX_VERTICAL_RATIO = 0.3;
        var MIN_HORIZONTAL_DISTANCE = 30;
        return function (scope, element, attr) {
          var swipeHandler = $parse(attr[directiveName]);
          var startCoords, valid;
          function validSwipe(coords) {
            if (!startCoords)
              return false;
            var deltaY = Math.abs(coords.y - startCoords.y);
            var deltaX = (coords.x - startCoords.x) * direction;
            return valid && deltaY < MAX_VERTICAL_DISTANCE && deltaX > 0 && deltaX > MIN_HORIZONTAL_DISTANCE && deltaY / deltaX < MAX_VERTICAL_RATIO;
          }
          $swipe.bind(element, {
            'start': function (coords, event) {
              startCoords = coords;
              valid = true;
            },
            'cancel': function (event) {
              valid = false;
            },
            'end': function (coords, event) {
              if (validSwipe(coords)) {
                scope.$apply(function () {
                  element.triggerHandler(eventName);
                  swipeHandler(scope, { $event: event });
                });
              }
            }
          });
        };
      }
    ]);
  }
  makeSwipeDirective('ngSwipeLeft', -1, 'swipeleft');
  makeSwipeDirective('ngSwipeRight', 1, 'swiperight');
}(window, window.angular));