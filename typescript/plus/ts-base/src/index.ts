require('./datatype')
require('./enum')
require('./interface')
require('./function')
require('./class')
require('./class_with_interface')
require('./generics')
require('./type_check')
require('./high_type')

;(() => {
  const hello: string = 'hello world'
  
  document.querySelectorAll('.app')[0].innerHTML = hello
})();
