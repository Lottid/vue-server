'use strict';

var cssParser = require('../css');
var common = require('./common.js');
var utils = require('./../utils.js');
var slotContent = require('./slot-content.js');

var compilers = {
    compile: function compile(vm) {
        compilers.compileViewModels(vm);
        return vm;
    },

    compileViewModels: function compileViewModels(vm) {
        var childVm;

        compilers.compileElements(vm, [vm.$el]);

        // If component's template is empty, but extra content was
        // provided inside component's init tag, then we paste the content inside
        // ref to test/spec/component.spec/component.spec.js #comp-empty-inner
        if (!vm.$el.inner.length && vm.$el._content) {
            vm.$el.inner = vm.$el._content.inner;
            return;
        }

        if (!vm.__states.children) {
            return;
        }

        for (var i = 0, l = vm.__states.children.length; i < l; i++) {
            childVm = vm.__states.children[i];
            compilers.compileViewModels(childVm);
        }
    },

    compileElements: function compileElements(vm, elements, customIndex) {
        var element;

        for (var i = customIndex || 0, l = elements.length; i < l; i++) {
            element = common.setElement(elements[i]);
            if (element.hidden) {
                // @todo rethink the strategy
                elements.splice(i, 1);
                compilers.compileElements(vm, elements, i);
                break;
            }
            compilers.compileElement(vm, element, i);
        }
    },

    compileElement: function compileElement(vm, element, index) {
        compilers.compileTag(vm, element);

        if (element._isKeyElement && vm.$el !== element) {
            return;
        }

        // Text node
        if (element.type === 'text') {
            element.text = common.execute(vm, element.text);
        }

        // Node childs
        if (element.inner) {
            compilers.compileElements(vm, element.inner);
        }
    },

    compileTag: function compileTag(vm, element) {
        if (element.compiled ||
        // A hardcode for a case when a component compiles inside slot content
        vm.$el === element && !vm.__states.isRepeat) {
            return;
        }

        if (element.type === 'tag') {
            if (element.name === 'slot') {
                (function () {
                    var content = slotContent.getContent(vm);
                    if (content) {
                        compilers.compileElements(vm.$parent, content);
                        slotContent.insert(vm, element, content);
                    }
                })();
            }

            // Element's component template should be empty to accept its inner content
            if (element._componentEmptyTpl && element._innerContent) {
                compilers.compileElements(vm, element._innerContent);
                element.inner = element._innerContent;
            }

            // v-model
            if (element.dirs.model) {
                compilers.compileDirectiveModel(vm, element);
            }

            // v-text
            if (element.dirs.text) {
                compilers.setInnerText(element, common.execute(vm, {
                    value: element.dirs.text.value.get,
                    filters: element.dirs.text.value.filters,
                    isEscape: true,
                    isClean: true
                }));
            }

            // v-html
            if (element.dirs.html) {
                compilers.setInnerText(element, common.execute(vm, {
                    value: element.dirs.html.value.get,
                    filters: element.dirs.html.value.filters,
                    isEscape: false,
                    isClean: true
                }));
            }

            // v-el
            if (element.dirs.el) {}
            // Not done yet


            // Compile node attributes
            utils.each(element.attribs, function (item, key) {
                element.attribs[key] = common.execute(vm, item, {
                    isEscape: false,
                    isEscapeQuotes: true
                });
            });

            // @todo Разобраться с форматами style и class - привести к одному виду
            // не забыть про renders
            compilers.compileDirectiveShow(vm, element);

            // NEW SYNTAX
            // v-bind:
            if (element.dirs.bind) {
                utils.each(element.dirs.bind, function (item, name) {
                    if (item.isCompiled) {
                        return;
                    }

                    var value = common.execute(vm, {
                        value: item.value.get,
                        filters: item.value.filters,
                        isEscapeQuotes: true
                    });

                    if (name === 'style') {
                        (function () {
                            // Need to consider element's own styles
                            var originalStyle = cssParser.parse(element.attribs.style || '');

                            // Drop value if class is Array
                            if (typeof value === 'string') {
                                value = cssParser.parse(value);
                            } else if (Array.isArray(value)) {
                                value = utils.extend.apply(common, value);
                            }

                            if (value.display && element.dirs.show && element.dirs.show.order > item.order) {
                                delete value.display;
                            }

                            element.attribs.style = {
                                own: originalStyle,
                                dir: value
                            };
                        })();

                        return;
                    }

                    if (name === 'class') {
                        (function () {
                            var classListOwn = [];
                            var classListDir = [];

                            if (element.attribs.class) {
                                classListOwn = element.attribs.class.split(' ');
                            }

                            if (typeof value === 'string') {
                                classListDir = value.split(' ');
                            } else if (Array.isArray(value)) {
                                classListDir = value;
                            } else {
                                for (var name in value) {
                                    if (value[name]) {
                                        classListDir.push(name);
                                    }
                                }
                            }
                            element.attribs.class = {
                                own: classListOwn,
                                dir: classListDir
                            };
                        })();

                        return;
                    }

                    element.attribs[name] = value;
                });
            }

            // v-bind="{...}"
            if (element.dirs.bindMany) {
                (function () {
                    var value = common.execute(vm, {
                        value: element.dirs.bindMany.value.get,
                        filters: element.dirs.bindMany.value.filters,
                        isEscapeQuotes: true
                    });

                    utils.extend(element.attribs, value);
                })();
            }

            // setSelected (hack for v-for <select> options)
            if (element.dirs.setSelected) {
                if (element.dirs.setSelected.value.map[element.attribs.value] || element.attribs.value === element.dirs.setSelected.value.original) {
                    element.attribs.selected = 'selected';
                }
            }

            element.compiled = true;
        }
    },

    setInnerText: function setInnerText(element, text) {
        element.inner = [{
            'type': 'text',
            'text': text
        }];
    },

    // v-show
    compileDirectiveShow: function compileDirectiveShow(vm, element) {
        if (!element.dirs.show) {
            return;
        }
        var styles = {};
        var isToShow = common.getValue(vm, element.dirs.show.value.get);
        var originalStyle = element.attribs.style;
        if (originalStyle) {
            originalStyle = cssParser.parse(originalStyle);
        }

        if (!isToShow) {
            styles.display = 'none';
        } else if (originalStyle && originalStyle.display === 'none') {
            styles.display = '';
        }

        if (utils.size(styles)) {
            if (originalStyle) {
                element.attribs.style = cssParser.stringify(cssParser.merge(originalStyle, styles));
            } else {
                element.attribs.style = cssParser.stringify(styles);
            }
        }
    },

    // v-model
    compileDirectiveModel: function compileDirectiveModel(vm, element) {
        var selectOptions;
        var vModelValue;
        var selectValueMap;
        var selectStaticOption;

        var attrValue = common.getAttribute(vm, element, 'value');
        var attrType = common.getAttribute(vm, element, 'type');

        // If tag has "value" property then it should override v-model value
        if (attrValue && attrType == 'text') {
            return;
        }

        vModelValue = common.execute(vm, {
            value: element.dirs.model.value.get,
            filters: element.dirs.model.value.filters,
            isEscape: false,
            isClean: false
        });

        if (element.name === 'input') {
            if (!attrType || attrType === 'text') {
                element.attribs.value = common.cleanValue(vModelValue);
            }

            if (attrType === 'checkbox' && vModelValue) {
                if (Array.isArray(vModelValue)) {
                    if (vModelValue.indexOf(attrValue) !== -1) {
                        element.attribs.checked = 'checked';
                    }
                } else {
                    element.attribs.checked = 'checked';
                }
            }

            if (attrType === 'radio') {
                if (attrValue && attrValue == vModelValue) {
                    element.attribs.checked = 'checked';
                } else {
                    element.attribs.checked = undefined;
                }
            }
        }

        if (element.name === 'select') {
            selectValueMap = {};

            if (element.dirs.model.options.options) {
                selectOptions = common.execute(vm, {
                    value: element.dirs.model.options.options.get,
                    filters: element.dirs.model.options.options.filters,
                    isEscape: false,
                    isClean: false
                });

                // Store first static element if exists
                if (element.inner[0] && element.inner[0].name === 'option') {
                    selectStaticOption = element.inner[0];
                }

                // Clear <select> tag content
                element.inner = [];

                // Insert first static element
                if (selectStaticOption) {
                    element.inner.push(selectStaticOption);
                }

                if (selectOptions) {
                    for (var i = 0, l = selectOptions.length; i < l; i++) {
                        var optionItem = {
                            type: 'tag',
                            name: 'option',
                            dirs: {},
                            attribs: {
                                'value': selectOptions[i].value
                            }
                        };

                        compilers.setInnerText(optionItem, selectOptions[i].text);
                        element.inner.push(optionItem);
                    }
                }
            }

            // If select value is Array
            // Making value map avoiding multiple array busting
            if (element.attribs.multiple !== undefined) {
                if (vModelValue) {
                    for (var j = 0, n = vModelValue.length; j < n; j++) {
                        selectValueMap[vModelValue[j]] = true;
                    }
                }

                // Single choice <select>
            } else {
                selectValueMap[vModelValue] = true;
            }

            for (var k = 0, o = element.inner.length; k < o; k++) {
                var item = element.inner[k];
                compilers.prepareSelectOption(vm, item, vModelValue, selectValueMap);
            }
        }

        if (element.name === 'textarea') {
            compilers.setInnerText(element, vModelValue);
        }
    },

    prepareSelectOption: function prepareSelectOption(vm, item, vModelValue, selectValueMap) {
        if (item.name === '$merge') {
            compilers.prepareSelectOption(vm, item.inner[0], vModelValue, selectValueMap);
            return;
        }

        if (item.name === 'option') {
            item.dirs.setSelected = {
                value: {
                    original: vModelValue,
                    map: selectValueMap
                }
            };
            if (selectValueMap[common.getValue(vm, item.attribs.value)]) {
                item.attribs.selected = 'selected';
            } else {
                item.attribs.selected = undefined;
            }
        }
    }
};

module.exports = compilers;