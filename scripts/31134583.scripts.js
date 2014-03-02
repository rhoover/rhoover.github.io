'use strict';
angular.module('mooseDogApp', [
  'ngAnimate',
  'ngTouch'
]);
'use strict';
angular.module('mooseDogApp').directive('rhBackground', function () {
  return {
    restrict: 'A',
    link: function (scope, element, attrs) {
      var result = getComputedStyle(element[0], ':after').content;
      result = result.replace(/"/g, '');
      switch (result) {
      case 'phone':
        element.addClass('bg-small');
        break;
      case 'tablet':
        element.addClass('bg-medium');
        break;
      case 'small-desktop':
        element.addClass('bg-small-desktop');
        break;
      case 'large-desktop':
        element.addClass('bg-large-desktop');
        break;
      }
      ;
    }
  };
});
'use strict';
angular.module('mooseDogApp').controller('HtmlCtrl', [
  '$scope',
  function ($scope) {
    $scope.$on('$viewContentLoaded', function () {
      $scope.loading = false;
    });
  }
]);
'use strict';
angular.module('mooseDogApp').controller('CarouselCtrl', [
  '$scope',
  function ($scope) {
    $scope.counter = 0;
    $scope.slideLeft = function () {
      if ($scope.counter < 4) {
        $scope.counter++;
      } else {
        return;
      }
      ;
    };
    $scope.slideRight = function () {
      if ($scope.counter > 0) {
        $scope.counter--;
      } else {
        return;
      }
      ;
    };
  }
]);