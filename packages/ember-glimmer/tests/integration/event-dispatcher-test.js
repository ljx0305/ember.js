import { RenderingTest, moduleFor } from '../utils/test-case';
import { Component } from '../utils/helpers';
import { getCurrentRunLoop, run } from '@ember/runloop';
import {
  subscribe as instrumentationSubscribe,
  reset as instrumentationReset,
} from '@ember/instrumentation';
import { EMBER_IMPROVED_INSTRUMENTATION } from '@ember/canary-features';
import { jQueryDisabled, jQuery } from 'ember-views';
import { HAS_NATIVE_PROXY } from 'ember-utils';
import { DEBUG } from '@glimmer/env';

let canDataTransfer = !!document.createEvent('HTMLEvents').dataTransfer;

function fireNativeWithDataTransfer(node, type, dataTransfer) {
  let event = document.createEvent('HTMLEvents');
  event.initEvent(type, true, true);
  event.dataTransfer = dataTransfer;
  node.dispatchEvent(event);
}

moduleFor(
  'EventDispatcher',
  class extends RenderingTest {
    ['@test events bubble view hierarchy for form elements'](assert) {
      let receivedEvent;

      this.registerComponent('x-foo', {
        ComponentClass: Component.extend({
          change(event) {
            receivedEvent = event;
          },
        }),
        template: `<input id="is-done" type="checkbox">`,
      });

      this.render(`{{x-foo}}`);

      this.runTask(() => this.$('#is-done').trigger('change'));
      assert.ok(receivedEvent, 'change event was triggered');
      assert.strictEqual(receivedEvent.target, this.$('#is-done')[0]);
    }

    ['@test case insensitive events'](assert) {
      let receivedEvent;

      this.registerComponent('x-bar', {
        ComponentClass: Component.extend({
          clicked(event) {
            receivedEvent = event;
          },
        }),
        template: `<button id="is-done" onclick={{action clicked}}>my button</button>`,
      });

      this.render(`{{x-bar}}`);

      this.runTask(() => this.$('#is-done').trigger('click'));
      assert.ok(receivedEvent, 'change event was triggered');
      assert.strictEqual(receivedEvent.target, this.$('#is-done')[0]);
    }

    ['@test case sensitive events'](assert) {
      let receivedEvent;

      this.registerComponent('x-bar', {
        ComponentClass: Component.extend({
          clicked(event) {
            receivedEvent = event;
          },
        }),
        template: `<button id="is-done" onClick={{action clicked}}>my button</button>`,
      });

      this.render(`{{x-bar}}`);

      this.runTask(() => this.$('#is-done').trigger('click'));
      assert.ok(receivedEvent, 'change event was triggered');
      assert.strictEqual(receivedEvent.target, this.$('#is-done')[0]);
    }

    ['@test events bubble to parent view'](assert) {
      let receivedEvent;

      this.registerComponent('x-foo', {
        ComponentClass: Component.extend({
          change(event) {
            receivedEvent = event;
          },
        }),
        template: `{{yield}}`,
      });

      this.registerComponent('x-bar', {
        ComponentClass: Component.extend({
          change() {},
        }),
        template: `<input id="is-done" type="checkbox">`,
      });

      this.render(`{{#x-foo}}{{x-bar}}{{/x-foo}}`);

      this.runTask(() => this.$('#is-done').trigger('change'));
      assert.ok(receivedEvent, 'change event was triggered');
      assert.strictEqual(receivedEvent.target, this.$('#is-done')[0]);
    }

    ['@test events bubbling up can be prevented'](assert) {
      let hasReceivedEvent;

      this.registerComponent('x-foo', {
        ComponentClass: Component.extend({
          change() {
            hasReceivedEvent = true;
          },
        }),
        template: `{{yield}}`,
      });

      this.registerComponent('x-bar', {
        ComponentClass: Component.extend({
          change() {
            return false;
          },
        }),
        template: `<input id="is-done" type="checkbox">`,
      });

      this.render(`{{#x-foo}}{{x-bar}}{{/x-foo}}`);

      this.runTask(() => this.$('#is-done').trigger('change'));
      assert.notOk(hasReceivedEvent, 'change event has not been received');
    }

    ['@test event handlers are wrapped in a run loop'](assert) {
      this.registerComponent('x-foo', {
        ComponentClass: Component.extend({
          change() {
            assert.ok(getCurrentRunLoop(), 'a run loop should have started');
          },
        }),
        template: `<input id="is-done" type="checkbox">`,
      });

      this.render(`{{x-foo}}`);

      this.$('#is-done').trigger('click');
    }
  }
);

moduleFor(
  'EventDispatcher#setup',
  class extends RenderingTest {
    constructor() {
      super(...arguments);

      let dispatcher = this.owner.lookup('event_dispatcher:main');
      run(dispatcher, 'destroy');
      this.owner.__container__.reset('event_dispatcher:main');
      this.dispatcher = this.owner.lookup('event_dispatcher:main');
    }

    ['@test additional events can be specified'](assert) {
      this.dispatcher.setup({ myevent: 'myEvent' });

      this.registerComponent('x-foo', {
        ComponentClass: Component.extend({
          myEvent() {
            assert.ok(true, 'custom event was triggered');
          },
        }),
        template: `<p>Hello!</p>`,
      });

      this.render(`{{x-foo}}`);

      this.$('div').trigger('myevent');
    }

    ['@test a rootElement can be specified'](assert) {
      this.element.innerHTML = '<div id="app"></div>';
      // this.$().append('<div id="app"></div>');
      this.dispatcher.setup({ myevent: 'myEvent' }, '#app');

      assert.ok(this.$('#app').hasClass('ember-application'), 'custom rootElement was used');
      assert.equal(this.dispatcher.rootElement, '#app', 'the dispatchers rootElement was updated');
    }

    ['@test default events can be disabled via `customEvents`'](assert) {
      this.dispatcher.setup({ click: null });

      this.registerComponent('x-foo', {
        ComponentClass: Component.extend({
          click() {
            assert.ok(false, 'click method was called');
          },

          null() {
            assert.ok(false, 'null method was called');
          },

          doubleClick() {
            assert.ok(true, 'a non-disabled event is still handled properly');
          },
        }),

        template: `<p>Hello!</p>`,
      });

      this.render(`{{x-foo}}`);

      this.$('div').trigger('click');
      this.$('div').trigger('dblclick');
    }

    ['@test throws if specified rootElement does not exist'](assert) {
      assert.throws(() => {
        this.dispatcher.setup({ myevent: 'myEvent' }, '#app');
      });
    }
  }
);

if (EMBER_IMPROVED_INSTRUMENTATION) {
  moduleFor(
    'EventDispatcher - Instrumentation',
    class extends RenderingTest {
      teardown() {
        super.teardown();
        instrumentationReset();
      }

      ['@test instruments triggered events'](assert) {
        let clicked = 0;

        this.registerComponent('x-foo', {
          ComponentClass: Component.extend({
            click() {
              clicked++;
            },
          }),
          template: `<p>hello</p>`,
        });

        this.render(`{{x-foo}}`);

        this.$('div').trigger('click');

        assert.equal(clicked, 1, 'precond - the click handler was invoked');

        let clickInstrumented = 0;
        instrumentationSubscribe('interaction.click', {
          before() {
            clickInstrumented++;
            assert.equal(clicked, 1, 'invoked before event is handled');
          },
          after() {
            clickInstrumented++;
            assert.equal(clicked, 2, 'invoked after event is handled');
          },
        });

        let keypressInstrumented = 0;
        instrumentationSubscribe('interaction.keypress', {
          before() {
            keypressInstrumented++;
          },
          after() {
            keypressInstrumented++;
          },
        });

        this.$('div').trigger('click');
        this.$('div').trigger('change');
        assert.equal(clicked, 2, 'precond - The click handler was invoked');
        assert.equal(clickInstrumented, 2, 'The click was instrumented');
        assert.strictEqual(keypressInstrumented, 0, 'The keypress was not instrumented');
      }
    }
  );
}

if (canDataTransfer) {
  moduleFor(
    'EventDispatcher - Event Properties',
    class extends RenderingTest {
      ['@test dataTransfer property is added to drop event'](assert) {
        let receivedEvent;
        this.registerComponent('x-foo', {
          ComponentClass: Component.extend({
            drop(event) {
              receivedEvent = event;
            },
          }),
        });

        this.render(`{{x-foo}}`);

        fireNativeWithDataTransfer(this.$('div')[0], 'drop', 'success');
        assert.equal(receivedEvent.dataTransfer, 'success');
      }
    }
  );
}

if (jQueryDisabled) {
  moduleFor(
    'EventDispatcher#native-events',
    class extends RenderingTest {
      ['@test native events are passed when jQuery is not present'](assert) {
        let receivedEvent;

        this.registerComponent('x-foo', {
          ComponentClass: Component.extend({
            click(event) {
              receivedEvent = event;
            },
          }),
          template: `<button id="foo">bar</button>`,
        });

        this.render(`{{x-foo}}`);

        this.runTask(() => this.$('#foo').click());
        assert.ok(receivedEvent, 'click event was triggered');
        assert.notOk(receivedEvent.originalEvent, 'event is not a jQuery.Event');
      }
    }
  );
} else {
  moduleFor(
    'EventDispatcher#jquery-events',
    class extends RenderingTest {
      beforeEach() {
        this.jqueryIntegration = window.ENV._JQUERY_INTEGRATION;
      }

      afterEach() {
        window.ENV._JQUERY_INTEGRATION = this.jqueryIntegration;
      }

      ['@test jQuery events are passed when jQuery is present'](assert) {
        let receivedEvent;

        this.registerComponent('x-foo', {
          ComponentClass: Component.extend({
            click(event) {
              receivedEvent = event;
            },
          }),
          template: `<button id="foo">bar</button>`,
        });

        this.render(`{{x-foo}}`);

        this.runTask(() => this.$('#foo').click());
        assert.ok(receivedEvent, 'click event was triggered');
        assert.ok(receivedEvent instanceof jQuery.Event, 'event is a jQuery.Event');
      }

      [`@${HAS_NATIVE_PROXY ? 'test' : 'skip'} accessing jQuery.Event#originalEvent is deprecated`](
        assert
      ) {
        let receivedEvent;

        this.registerComponent('x-foo', {
          ComponentClass: Component.extend({
            click(event) {
              receivedEvent = event;
            },
          }),
          template: `<button id="foo">bar</button>`,
        });

        this.render(`{{x-foo}}`);

        this.runTask(() => this.$('#foo').click());
        expectDeprecation(() => {
          let { originalEvent } = receivedEvent;
          assert.ok(originalEvent, 'jQuery event has originalEvent property');
          assert.equal(originalEvent.type, 'click', 'properties of originalEvent are available');
        }, 'Accessing jQuery.Event specific properties is deprecated. Either use the ember-jquery-legacy addon to normalize events to native events, or explicitly opt into jQuery integration using @ember/optional-features.');
      }

      ['@test other jQuery.Event properties do not trigger deprecation'](assert) {
        let receivedEvent;

        this.registerComponent('x-foo', {
          ComponentClass: Component.extend({
            click(event) {
              receivedEvent = event;
            },
          }),
          template: `<button id="foo">bar</button>`,
        });

        this.render(`{{x-foo}}`);

        this.runTask(() => this.$('#foo').click());
        expectNoDeprecation(() => {
          receivedEvent.stopPropagation();
          receivedEvent.stopImmediatePropagation();
          receivedEvent.preventDefault();
          assert.ok(receivedEvent.bubbles, 'properties of jQuery event are available');
          assert.equal(receivedEvent.type, 'click', 'properties of jQuery event are available');
        });
      }

      ['@test accessing jQuery.Event#originalEvent does not trigger deprecations when jquery integration is explicitly enabled'](
        assert
      ) {
        let receivedEvent;
        window.ENV._JQUERY_INTEGRATION = true;

        this.registerComponent('x-foo', {
          ComponentClass: Component.extend({
            click(event) {
              receivedEvent = event;
            },
          }),
          template: `<button id="foo">bar</button>`,
        });

        this.render(`{{x-foo}}`);

        this.runTask(() => this.$('#foo').click());
        expectNoDeprecation(() => {
          let { originalEvent } = receivedEvent;
          assert.ok(originalEvent, 'jQuery event has originalEvent property');
          assert.equal(originalEvent.type, 'click', 'properties of originalEvent are available');
        });
      }

      [`@${
        HAS_NATIVE_PROXY && DEBUG ? 'test' : 'skip'
      } accessing jQuery.Event#__originalEvent does not trigger deprecations to support ember-jquery-legacy`](
        assert
      ) {
        let receivedEvent;

        this.registerComponent('x-foo', {
          ComponentClass: Component.extend({
            click(event) {
              receivedEvent = event;
            },
          }),
          template: `<button id="foo">bar</button>`,
        });

        this.render(`{{x-foo}}`);

        this.runTask(() => this.$('#foo').click());
        expectNoDeprecation(() => {
          let { __originalEvent: originalEvent } = receivedEvent;
          assert.ok(originalEvent, 'jQuery event has __originalEvent property');
          assert.equal(originalEvent.type, 'click', 'properties of __originalEvent are available');
        });
      }
    }
  );
}
